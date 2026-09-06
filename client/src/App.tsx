import { Home } from './Home';
import { Room } from './Room';

export default function App() {
  const m = window.location.pathname.match(/^\/r\/([A-Za-z0-9]{4,10})$/);
  if (m) return <Room roomId={m[1].toUpperCase()} />;
  return <Home />;
}
