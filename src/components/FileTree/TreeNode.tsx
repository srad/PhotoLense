import type { TreeNodeData } from "../../types";
import "./FileTree.css";

interface TreeNodeProps {
  node: TreeNodeData;
  depth: number;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string) => void;
}

export function TreeNode({
  node,
  depth,
  selectedPath,
  onToggle,
  onSelect,
  onContextMenu,
}: TreeNodeProps) {
  const isSelected = node.path === selectedPath;
  const hasChildren = node.children && node.children.length > 0;

  const handleClick = () => {
    onSelect(node.path);
    onToggle(node.path);
  };

  return (
    <div className="tree-node-container">
      <div
        className={`tree-node ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node.path)}
      >
        <span className="tree-chevron">
          {node.loaded && !hasChildren ? (
            <span style={{ width: 14 }} />
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              style={{
                transform: node.expanded ? "rotate(90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <path d="M8 5l8 7-8 7V5z" />
            </svg>
          )}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="tree-icon"
          style={{ color: node.expanded ? "var(--accent)" : "var(--warning)" }}
        >
          {node.expanded ? (
            <path d="M20 19H4a1 1 0 0 1-1-.93V6a1 1 0 0 1 1-1h6l2 2h8a1 1 0 0 1 1 1v2H7.5L5 18h15.67l-1.2-6H21l1.27 6.34A1 1 0 0 1 21.27 19Z" />
          ) : (
            <path d="M20 7H12L10 5H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z" />
          )}
        </svg>
        <span className="tree-label" title={node.path}>
          {node.name}
        </span>
      </div>
      {node.expanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}
