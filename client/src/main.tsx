import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';

// No <React.StrictMode>: its double-invoke would break RoomSocket.close()'s one-way latch
// and the mesh's track teardown.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
