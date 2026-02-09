import { memo } from "react";
import "./GroupIndex.css";

interface GroupIndexProps {
  groups: { color: string; count: number }[];
  onScrollToGroup: (color: string) => void;
}

export const GroupIndex = memo(function GroupIndex({ groups, onScrollToGroup }: GroupIndexProps) {
  if (!groups || groups.length === 0) return null;

  return (
    <div className="group-index">
      {groups.map((g) => (
        <button
          key={g.color}
          className="group-index-item"
          onClick={() => onScrollToGroup(g.color)}
          title={`Jump to ${g.color}`}
        >
          <div
            className="group-index-swatch"
            style={{
              backgroundColor: g.color === "Unknown" ? "#666" : g.color,
            }}
          />
          <span className="group-index-label">{g.color}</span>
          <span className="group-index-count">{g.count}</span>
        </button>
      ))}
    </div>
  );
});
