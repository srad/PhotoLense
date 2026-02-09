import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppState } from "../../hooks/useAppState";
import "./SimilaritySlider.css";

export function SimilaritySlider() {
  const { similaritySearch } = useAppState();
  const dispatch = useAppDispatch();
  const [sliderValue, setSliderValue] = useState(similaritySearch?.threshold ?? 50);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (similaritySearch) {
      setSliderValue(similaritySearch.threshold);
    }
  }, [similaritySearch]);

  if (!similaritySearch) return null;

  const fileName = similaritySearch.referencePath.split(/[\\/]/).pop() ?? "";

  const onSliderChange = (value: number) => {
    setSliderValue(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      dispatch({ type: "SET_SIMILARITY_THRESHOLD", threshold: value });
    }, 300);
  };

  return (
    <div className="similarity-controls">
      <span className="similarity-label" title={similaritySearch.referencePath}>
        Similar to: {fileName}
      </span>
      <input
        type="range"
        className="similarity-slider"
        min={0}
        max={100}
        step={1}
        value={sliderValue}
        onChange={(e) => onSliderChange(Number(e.target.value))}
      />
      <span className="similarity-value">Min similarity: {sliderValue}%</span>
      <button
        className="similarity-exit-btn"
        onClick={() => dispatch({ type: "SET_SIMILARITY_SEARCH", search: null })}
        title="Exit similarity search"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  );
}
