import { useState } from "react";
import "./ColorGroupDialog.css";

interface ColorGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onGroup: (method: "fixed" | "kmeans", k?: number) => void;
  loading: boolean;
}

export function ColorGroupDialog({ open, onClose, onGroup, loading }: ColorGroupDialogProps) {
  const [method, setMethod] = useState<"fixed" | "kmeans">("fixed");
  const [k, setK] = useState(8);

  if (!open) return null;

  return (
    <div className="color-group-overlay">
      <div className="color-group-dialog">
        <h3>Group by Color</h3>
        
        <div className="form-group">
          <label>Algorithm</label>
          <div className="radio-group">
            <label>
              <input 
                type="radio" 
                checked={method === "fixed"} 
                onChange={() => setMethod("fixed")} 
              />
              Fixed Palette
            </label>
            <label>
              <input 
                type="radio" 
                checked={method === "kmeans"} 
                onChange={() => setMethod("kmeans")} 
              />
              K-Means Clustering
            </label>
          </div>
        </div>

        {method === "kmeans" && (
          <div className="form-group">
            <label>Number of Clusters (K): {k}</label>
            <input 
              type="range" 
              min="2" 
              max="100"
              value={k} 
              onChange={(e) => setK(Number(e.target.value))} 
            />
          </div>
        )}

        <div className="dialog-actions">
          <button className="cancel-btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button 
            className="group-btn" 
            onClick={() => onGroup(method, k)}
            disabled={loading}
          >
            {loading ? (
               <div className="spinner-sm" />
            ) : (
              "Group Photos"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
