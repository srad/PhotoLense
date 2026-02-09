import { AppStateContext, AppDispatchContext, useAppReducer } from "./hooks/useAppState";
import { NotificationProvider } from "./hooks/useNotifications";
import { AppToolbar } from "./components/AppToolbar/AppToolbar";
import { FileTree } from "./components/FileTree/FileTree";
import { PhotoPanel } from "./components/PhotoPanel/PhotoPanel";
import { ClassifyDialog } from "./components/ClassifyDialog/ClassifyDialog";
import { ContextMenu } from "./components/common/ContextMenu";
import { NotificationStack } from "./components/NotificationStack/NotificationStack";
import { StatusBar } from "./components/StatusBar/StatusBar";
import "./styles/variables.css";
import "./App.css";

function App() {
  const [state, dispatch] = useAppReducer();

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <NotificationProvider>
          <div className="app-layout">
            <AppToolbar />
            <div className="app-body">
              <FileTree />
              <PhotoPanel />
            </div>
            {state.error && (
              <div className="app-error-bar">
                <span>{state.error}</span>
                <button onClick={() => dispatch({ type: "SET_ERROR", error: null })}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            <StatusBar />
            <ClassifyDialog />
            <ContextMenu />
            <NotificationStack />
          </div>
        </NotificationProvider>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export default App;
