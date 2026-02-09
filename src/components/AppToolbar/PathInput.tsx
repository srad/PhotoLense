import React, { useState, useEffect, useRef } from "react";
import { checkPathExists, autocompletePath } from "../../api/commands";
import "./PathInput.css";

const HISTORY_KEY = "photolense_path_history";
const MAX_HISTORY = 20;

interface PathInputProps {
  selectedFolder: string | null;
  onNavigate: (path: string) => Promise<boolean>;
}

export function PathInput({ selectedFolder, onNavigate }: PathInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isValidating, setIsValidating] = useState(false);
  const [isInvalid, setIsInvalid] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load history on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Failed to load path history", e);
    }
  }, []);

  // Update input when external selection changes (unless editing)
  useEffect(() => {
    if (!isEditing && selectedFolder) {
      setInputValue(selectedFolder);
    }
  }, [selectedFolder, isEditing]);

  const addToHistory = (path: string) => {
    setHistory((prev) => {
      const newHistory = [path, ...prev.filter((p) => p !== path)].slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
      return newHistory;
    });
  };

  const handleFocus = () => {
    setIsEditing(true);
    setInputValue(selectedFolder || "");
    setShowHistory(true);
    setSelectedIndex(-1);
    
    // Select all text on focus
    requestAnimationFrame(() => {
      inputRef.current?.select();
    });
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Check if focus moved to dropdown
    if (dropdownRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    
    // Delay hiding to allow clicks to register
    setTimeout(() => {
      setIsEditing(false);
      setShowHistory(false);
      if (selectedFolder) {
        setInputValue(selectedFolder);
      }
    }, 200);
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setSelectedIndex(-1);
    setIsInvalid(false);

    if (value.trim() === "") {
      setSuggestions([]);
      setShowHistory(true);
      return;
    }

    setShowHistory(false); // Switch to suggestions mode
    try {
      const results = await autocompletePath(value);
      setSuggestions(results);
    } catch (e) {
      console.error("Autocomplete failed", e);
      setSuggestions([]);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsEditing(false);
      setShowHistory(false);
      if (selectedFolder) {
        setInputValue(selectedFolder);
      }
      inputRef.current?.blur();
      return;
    }

    const items = showHistory ? history : suggestions;
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Tab") {
        if (!showHistory && suggestions.length > 0) {
            e.preventDefault();
            const target = selectedIndex >= 0 ? suggestions[selectedIndex] : suggestions[0];
            setInputValue(target);
        }
    } else if (e.key === "Enter") {
      e.preventDefault();
      
      let targetPath = inputValue;
      if (selectedIndex >= 0 && items[selectedIndex]) {
        targetPath = items[selectedIndex];
        setInputValue(targetPath);
      }

      // Cleanup path: trim and remove surrounding quotes
      targetPath = targetPath.trim().replace(/^["']|["']$/g, "");

      setIsValidating(true);
      const exists = await checkPathExists(targetPath);
      setIsValidating(false);

      if (exists) {
        const success = await onNavigate(targetPath);
        if (success) {
          addToHistory(targetPath);
          setIsEditing(false);
          setShowHistory(false);
          inputRef.current?.blur();
        } else {
            console.warn("Navigation failed for path:", targetPath);
            setIsInvalid(true);
        }
      } else {
        console.warn("Path does not exist:", targetPath);
        setIsInvalid(true);
        setTimeout(() => setIsInvalid(false), 500);
      }
    }
  };

  const handleSelect = async (path: string) => {
    setInputValue(path);
    setIsEditing(false);
    setShowHistory(false);
    
    setIsValidating(true);
    const success = await onNavigate(path);
    setIsValidating(false);
    
    if (success) {
      addToHistory(path);
    } else {
        setInputValue(selectedFolder || path);
        setIsInvalid(true);
        setTimeout(() => setIsInvalid(false), 500);
    }
  };

  const showDropdown = isEditing && (showHistory ? history.length > 0 : suggestions.length > 0);
  const displayItems = showHistory ? history : suggestions;

  return (
    <div className="path-input-container">
      <input
        ref={inputRef}
        type="text"
        className={`path-input ${isInvalid ? "invalid" : ""}`}
        value={inputValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="Enter path..."
        spellCheck={false}
      />
      
      {showDropdown && (
        <div className="path-dropdown" ref={dropdownRef} onMouseDown={(e) => e.preventDefault()}>
            <div className="path-dropdown-section-label">
                {showHistory ? "Recent" : "Suggestions"}
            </div>
            {displayItems.map((item, index) => (
            <div
              key={item}
              className={`path-dropdown-item ${index === selectedIndex ? "selected" : ""}`}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {showHistory ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
              )}
              <span className="tree-label" title={item}>{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
