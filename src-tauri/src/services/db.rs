use rusqlite::{params, Connection, Result};
use sqlite_vec::sqlite3_vec_init;
use std::path::Path;
use std::sync::{Arc, Mutex};
use zerocopy::IntoBytes;

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        // Register sqlite-vec as an auto-extension before opening any connection
        unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite3_vec_init as *const (),
            )));
        }

        let conn = Connection::open(path)?;

        // Enable WAL mode for better concurrency and performance
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        conn.execute_batch("PRAGMA synchronous = NORMAL;")?;

        // Create tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                size INTEGER,
                modified INTEGER,
                width INTEGER,
                height INTEGER
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY,
                photo_id INTEGER NOT NULL,
                tag TEXT NOT NULL,
                confidence REAL,
                FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS thumbnails (
                photo_id INTEGER PRIMARY KEY,
                data BLOB NOT NULL,
                FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Index for faster path lookups
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_photos_path ON photos(path)",
            [],
        )?;

        // Vec metadata table to track current model type and embedding dimension
        conn.execute(
            "CREATE TABLE IF NOT EXISTS vec_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Ensure the vec0 virtual table exists with the correct dimension for the current model.
    /// If the model type or dimension has changed, drops and recreates the table.
    pub fn ensure_vec_table(&self, dim: usize, model_type: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Check current stored model type and dimension
        let stored_model: Option<String> = conn
            .query_row(
                "SELECT value FROM vec_meta WHERE key = 'model_type'",
                [],
                |row| row.get(0),
            )
            .ok();
        let stored_dim: Option<String> = conn
            .query_row(
                "SELECT value FROM vec_meta WHERE key = 'embedding_dim'",
                [],
                |row| row.get(0),
            )
            .ok();

        let needs_recreate = stored_model.as_deref() != Some(model_type)
            || stored_dim.as_deref() != Some(&dim.to_string());

        if needs_recreate {
            // Drop existing vec_photos table if it exists
            conn.execute_batch("DROP TABLE IF EXISTS vec_photos")?;

            // Create vec0 virtual table with the correct dimension
            let create_sql = format!(
                "CREATE VIRTUAL TABLE vec_photos USING vec0(
                    photo_id INTEGER PRIMARY KEY,
                    embedding float[{}] distance_metric=cosine
                )",
                dim
            );
            conn.execute_batch(&create_sql)?;

            // Update metadata
            conn.execute(
                "INSERT OR REPLACE INTO vec_meta (key, value) VALUES ('model_type', ?1)",
                params![model_type],
            )?;
            conn.execute(
                "INSERT OR REPLACE INTO vec_meta (key, value) VALUES ('embedding_dim', ?1)",
                params![dim.to_string()],
            )?;
        }

        Ok(())
    }

    /// Store an embedding for a photo. The embedding must match the dimension of the vec0 table.
    pub fn set_embedding(&self, photo_id: i64, embedding: &[f32]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let bytes: &[u8] = embedding.as_bytes();
        conn.execute(
            "INSERT OR REPLACE INTO vec_photos (photo_id, embedding) VALUES (?1, ?2)",
            params![photo_id, bytes],
        )?;
        Ok(())
    }

    pub fn get_photos_to_index(&self, folder: &str) -> Result<Vec<(i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let folder_pattern = format!("{}%", folder);

        // Check if vec_photos exists
        let vec_table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='vec_photos'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        let sql = if vec_table_exists {
            "SELECT id, path FROM photos WHERE path LIKE ?1 AND id NOT IN (SELECT photo_id FROM vec_photos)"
        } else {
            "SELECT id, path FROM photos WHERE path LIKE ?1"
        };

        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([folder_pattern], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Check if a photo has an embedding stored.
    pub fn has_embedding(&self, photo_id: i64) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM vec_photos WHERE photo_id = ?1",
            params![photo_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Find similar photos using sqlite-vec KNN query.
    /// Returns (photo_id, path, size, modified, width, height, distance).
    pub fn find_similar_by_embedding(
        &self,
        photo_id: i64,
        folder: &str,
        max_distance: f32,
        limit: usize,
    ) -> Result<Vec<(i64, String, i64, i64, Option<u32>, Option<u32>, f32)>> {
        let conn = self.conn.lock().unwrap();
        let folder_pattern = format!("{}%", folder);

        // 1. Fetch reference embedding
        let ref_embedding: Vec<u8> = conn.query_row(
            "SELECT embedding FROM vec_photos WHERE photo_id = ?1",
            params![photo_id],
            |row| row.get(0),
        )?;

        // 2. KNN query using vec0's required `k = ?` constraint.
        //    sqlite-vec doesn't support LIMIT — it needs `k` in the WHERE clause.
        //    Additional filters (folder, distance) are applied in an outer query.
        let sql = "SELECT sub.photo_id, sub.distance, p.path, p.size, p.modified, p.width, p.height
             FROM (
               SELECT v.photo_id, v.distance
               FROM vec_photos v
               WHERE v.embedding MATCH ?1
                 AND k = ?2
             ) sub
             JOIN photos p ON p.id = sub.photo_id
             WHERE sub.photo_id != ?3
               AND p.path LIKE ?4
               AND sub.distance <= ?5
             ORDER BY sub.distance";

        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(
            params![ref_embedding, limit as i64, photo_id, folder_pattern, max_distance],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,    // photo_id
                    row.get::<_, f32>(1)?,    // distance
                    row.get::<_, String>(2)?, // path
                    row.get::<_, i64>(3)?,    // size
                    row.get::<_, i64>(4)?,    // modified
                    row.get::<_, Option<u32>>(5)?, // width
                    row.get::<_, Option<u32>>(6)?, // height
                ))
            },
        )?;

        let mut results = Vec::new();
        for row in rows {
            let r = row?;
            results.push((r.0, r.2, r.3, r.4, r.5, r.6, r.1));
        }
        Ok(results)
    }

    /// Get the photo_id for a given path.
    pub fn get_photo_id_by_path(&self, path: &str) -> Result<Option<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id FROM photos WHERE path = ?1")?;
        let mut rows = stmt.query([path])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Batch-fetch cached thumbnails by file paths in a single query.
    /// Returns a map of path → JPEG bytes for all paths that have cached thumbnails.
    pub fn get_cached_thumbnails_by_paths(
        &self,
        paths: &[String],
    ) -> Result<std::collections::HashMap<String, Vec<u8>>> {
        let conn = self.conn.lock().unwrap();
        if paths.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        let placeholders: String = (1..=paths.len())
            .map(|i| format!("?{}", i))
            .collect::<Vec<_>>()
            .join(", ");

        let sql = format!(
            "SELECT p.path, t.data FROM photos p \
             JOIN thumbnails t ON t.photo_id = p.id \
             WHERE p.path IN ({})",
            placeholders
        );

        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            paths.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();

        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?;

        let mut map = std::collections::HashMap::new();
        for row in rows {
            let (path, data) = row?;
            map.insert(path, data);
        }
        Ok(map)
    }

    /// Fetch cached thumbnail JPEG bytes for a photo.
    pub fn get_thumbnail(&self, photo_id: i64) -> Result<Option<Vec<u8>>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT data FROM thumbnails WHERE photo_id = ?1")?;
        let mut rows = stmt.query(params![photo_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Store (or replace) cached thumbnail JPEG bytes for a photo.
    pub fn save_thumbnail(&self, photo_id: i64, data: &[u8]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO thumbnails (photo_id, data) VALUES (?1, ?2)",
            params![photo_id, data],
        )?;
        Ok(())
    }

    /// Delete cached thumbnail for a photo (e.g. when the source file changes).
    #[allow(dead_code)]
    pub fn delete_thumbnail(&self, photo_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM thumbnails WHERE photo_id = ?1", params![photo_id])?;
        Ok(())
    }

    /// Returns (id, changed) where changed=true means new insert or modified-time update.
    pub fn upsert_photo(
        &self,
        path: &str,
        size: u64,
        modified: i64,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Result<(i64, bool)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, modified FROM photos WHERE path = ?1")?;
        let mut rows = stmt.query([path])?;

        if let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let db_modified: i64 = row.get(1)?;

            if db_modified != modified {
                conn.execute(
                    "UPDATE photos SET size = ?1, modified = ?2, width = ?3, height = ?4 WHERE id = ?5",
                    params![size as i64, modified, width, height, id],
                )?;
                Ok((id, true))
            } else {
                Ok((id, false))
            }
        } else {
            conn.execute(
                "INSERT INTO photos (path, size, modified, width, height) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![path, size as i64, modified, width, height],
            )?;
            Ok((conn.last_insert_rowid(), true))
        }
    }

    /// Batch upsert photos in a single transaction for much better performance.
    /// Returns Vec<(id, changed)> in the same order as input.
    pub fn batch_upsert_photos(
        &self,
        photos: &[(String, u64, i64, Option<u32>, Option<u32>)],
    ) -> Result<Vec<(i64, bool)>> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut results = Vec::with_capacity(photos.len());

        {
            let mut select_stmt = tx.prepare("SELECT id, modified FROM photos WHERE path = ?1")?;
            let mut update_stmt = tx.prepare(
                "UPDATE photos SET size = ?1, modified = ?2, width = ?3, height = ?4 WHERE id = ?5",
            )?;
            let mut insert_stmt = tx.prepare(
                "INSERT INTO photos (path, size, modified, width, height) VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            let mut del_thumb_stmt =
                tx.prepare("DELETE FROM thumbnails WHERE photo_id = ?1")?;

            for (path, size, modified, width, height) in photos {
                let mut rows = select_stmt.query([path])?;

                if let Some(row) = rows.next()? {
                    let id: i64 = row.get(0)?;
                    let db_modified: i64 = row.get(1)?;
                    drop(rows);

                    if db_modified != *modified {
                        update_stmt.execute(params![*size as i64, *modified, *width, *height, id])?;
                        del_thumb_stmt.execute(params![id])?;
                        results.push((id, true));
                    } else {
                        results.push((id, false));
                    }
                } else {
                    drop(rows);
                    insert_stmt.execute(params![path, *size as i64, *modified, *width, *height])?;
                    results.push((tx.last_insert_rowid(), true));
                }
            }
        }

        tx.commit()?;
        Ok(results)
    }

    pub fn add_tags(&self, photo_id: i64, tags: &[String]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        // Clear existing tags for this photo to avoid duplicates/stale tags
        tx.execute("DELETE FROM tags WHERE photo_id = ?1", params![photo_id])?;

        {
            let mut stmt = tx.prepare("INSERT INTO tags (photo_id, tag) VALUES (?1, ?2)")?;
            for tag in tags {
                stmt.execute(params![photo_id, tag])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn get_tags(&self, photo_id: i64) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT tag FROM tags WHERE photo_id = ?1")?;
        let rows = stmt.query_map([photo_id], |row| row.get(0))?;

        let mut tags = Vec::new();
        for tag in rows {
            tags.push(tag?);
        }
        Ok(tags)
    }

    pub fn get_tags_for_folder(&self, folder: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        // Get all unique tags for photos in this folder
        let folder_pattern = format!("{}%", folder);
        let mut stmt = conn.prepare(
            "SELECT DISTINCT t.tag
             FROM tags t
             JOIN photos p ON t.photo_id = p.id
             WHERE p.path LIKE ?1
             ORDER BY t.tag ASC",
        )?;

        let tags = stmt
            .query_map([folder_pattern], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(tags)
    }

    pub fn delete_tags_for_folder(&self, folder: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let folder_pattern = format!("{}%", folder);
        
        conn.execute(
            "DELETE FROM tags 
             WHERE photo_id IN (
                 SELECT id FROM photos WHERE path LIKE ?1
             )",
            params![folder_pattern],
        )?;
        Ok(())
    }

    pub fn query_photos(
        &self,
        folder: &str,
        search: Option<&str>,
        sort_by: &str,
        sort_order: &str,
        filter_tags: Option<&[String]>,
    ) -> Result<Vec<(i64, String, i64, i64, Option<u32>, Option<u32>)>> {
        let conn = self.conn.lock().unwrap();

        let order_col = match sort_by {
            "size" => "p.size",
            "date" => "p.modified",
            _ => "p.path",
        };
        let order_dir = if sort_order == "desc" { "DESC" } else { "ASC" };
        let folder_pattern = format!("{}%", folder);
        let search_pattern: Option<String> = search
            .filter(|s| !s.is_empty())
            .map(|s| format!("%{}%", s));

        // Build tag filter clause
        let tag_filter = if let Some(tags) = filter_tags {
            if !tags.is_empty() {
                let placeholders: Vec<String> =
                    tags.iter().enumerate().map(|(i, _)| format!("?{}", i + 3)).collect();
                format!(
                    " AND EXISTS (SELECT 1 FROM tags t WHERE t.photo_id = p.id AND t.tag IN ({}))",
                    placeholders.join(", ")
                )
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let sql = format!(
            "SELECT p.id, p.path, p.size, p.modified, p.width, p.height \
             FROM photos p \
             WHERE p.path LIKE ?1 \
               AND (?2 IS NULL \
                    OR p.path LIKE ?2 \
                    OR EXISTS (SELECT 1 FROM tags t WHERE t.photo_id = p.id AND t.tag LIKE ?2)){} \
             ORDER BY {} {}",
            tag_filter, order_col, order_dir
        );

        let mut stmt = conn.prepare(&sql)?;

        // Build params dynamically
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        param_values.push(Box::new(folder_pattern));
        param_values.push(Box::new(search_pattern));
        if let Some(tags) = filter_tags {
            for tag in tags {
                param_values.push(Box::new(tag.clone()));
            }
        }
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<u32>>(4)?,
                row.get::<_, Option<u32>>(5)?,
            ))
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Get all photo_ids that have embeddings (single scan of vec_photos).
    pub fn get_all_embedded_ids(&self) -> Result<std::collections::HashSet<i64>> {
        let conn = self.conn.lock().unwrap();

        let vec_table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='vec_photos'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if !vec_table_exists {
            return Ok(std::collections::HashSet::new());
        }

        let mut stmt = conn.prepare("SELECT photo_id FROM vec_photos")?;
        let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
        let mut set = std::collections::HashSet::new();
        for row in rows {
            set.insert(row?);
        }
        Ok(set)
    }

    #[allow(dead_code)]
    pub fn delete_photo_by_path(&self, path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM photos WHERE path = ?1", params![path])?;
        Ok(())
    }

    pub fn delete_photos_by_paths(&self, paths: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        for path in paths {
            conn.execute("DELETE FROM photos WHERE path = ?1", params![path])?;
        }
        Ok(())
    }

    pub fn update_photo_path(&self, old_path: &str, new_path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE photos SET path = ?1 WHERE path = ?2",
            params![new_path, old_path],
        )?;
        Ok(())
    }

    /// Pre-load all photo records for a folder into a HashMap for fast lookup.
    /// Returns path -> (id, modified, size, width, height).
    pub fn get_folder_photo_cache(
        &self,
        folder: &str,
    ) -> Result<std::collections::HashMap<String, (i64, i64, u64, Option<u32>, Option<u32>)>> {
        let conn = self.conn.lock().unwrap();
        let pattern = format!("{}%", folder);
        let mut stmt =
            conn.prepare("SELECT id, path, modified, size, width, height FROM photos WHERE path LIKE ?1")?;
        let rows = stmt.query_map([pattern], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<u32>>(4)?,
                row.get::<_, Option<u32>>(5)?,
            ))
        })?;
        let mut map = std::collections::HashMap::new();
        for row in rows {
            let (id, path, modified, size, width, height) = row?;
            map.insert(path, (id, modified, size as u64, width, height));
        }
        Ok(map)
    }

    /// Pre-load all tags for photos in a folder, grouped by photo_id.
    pub fn get_tags_for_folder_photos(
        &self,
        folder: &str,
    ) -> Result<std::collections::HashMap<i64, Vec<String>>> {
        let conn = self.conn.lock().unwrap();
        let folder_pattern = format!("{}%", folder);
        let mut stmt = conn.prepare(
            "SELECT t.photo_id, t.tag FROM tags t JOIN photos p ON t.photo_id = p.id WHERE p.path LIKE ?1",
        )?;
        let rows = stmt.query_map([folder_pattern], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map: std::collections::HashMap<i64, Vec<String>> =
            std::collections::HashMap::new();
        for row in rows {
            let (photo_id, tag) = row?;
            map.entry(photo_id).or_default().push(tag);
        }
        Ok(map)
    }

    pub fn cleanup_folder(&self, folder_path: &str, keep_paths: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let pattern = format!("{}%", folder_path);
        let mut stmt = conn.prepare("SELECT id, path FROM photos WHERE path LIKE ?1")?;

        let rows = stmt.query_map([pattern], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;

        let keep_set: std::collections::HashSet<&String> = keep_paths.iter().collect();
        let mut to_delete = Vec::new();

        for row in rows {
            let (id, path) = row?;
            if !keep_set.contains(&path) {
                to_delete.push(id);
            }
        }

        for id in to_delete {
            conn.execute("DELETE FROM photos WHERE id = ?1", params![id])?;
        }

        Ok(())
    }
}
