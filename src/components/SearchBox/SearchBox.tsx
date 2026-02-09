import "./SearchBox.css";
import { forwardRef } from "react";
import { Search } from "lucide-react";

type SearchBoxProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(
  ({value, onChange, placeholder = "Search photos... (Ctrl+F)"}, ref) => {
    return (
      <div className="search-box">
        <Search color="white" size={12}/>
        <input
          style={{marginLeft: 10}}
          ref={ref}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
);

SearchBox.displayName = "SearchBox";
