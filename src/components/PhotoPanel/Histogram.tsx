import "./PhotoPanel.css";

interface HistogramProps {
  data: string | null;
}

export function Histogram({ data }: HistogramProps) {
  return (
    <div className="histogram-container">
      {data ? (
        <img src={data} alt="Histogram" className="histogram-canvas" />
      ) : (
        <div className="histogram-placeholder">
          <div className="thumb-spinner" />
        </div>
      )}
    </div>
  );
}
