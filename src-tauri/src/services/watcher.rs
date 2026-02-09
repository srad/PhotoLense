use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

struct WatcherState {
    _watcher: RecommendedWatcher,
    path: String,
}

pub struct FolderWatcher {
    state: Mutex<Option<WatcherState>>,
}

impl FolderWatcher {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(None),
        }
    }

    pub fn watch_folder(&self, path: &str, app: AppHandle) {
        let mut state = self.state.lock().unwrap();

        // Already watching this path
        if let Some(ref s) = *state {
            if s.path == path {
                return;
            }
        }

        // Drop old watcher (stops old watch)
        *state = None;

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<()>();

        // Spawn debounce task
        tokio::spawn(async move {
            let mut rx = rx;
            loop {
                // Wait for first event
                if rx.recv().await.is_none() {
                    // Channel closed, watcher was dropped
                    break;
                }
                // Debounce: sleep then drain remaining events
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                while rx.try_recv().is_ok() {}
                // Emit event to frontend
                let _ = app.emit("folder-changed", ());
            }
        });

        let watch_path = std::path::PathBuf::from(path);
        let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                match event.kind {
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                        let _ = tx.send(());
                    }
                    _ => {}
                }
            }
        });

        match watcher {
            Ok(mut w) => {
                if let Err(e) = w.watch(&watch_path, RecursiveMode::NonRecursive) {
                    eprintln!("Failed to watch folder {}: {}", path, e);
                    return;
                }
                *state = Some(WatcherState {
                    _watcher: w,
                    path: path.to_string(),
                });
            }
            Err(e) => {
                eprintln!("Failed to create watcher: {}", e);
            }
        }
    }
}
