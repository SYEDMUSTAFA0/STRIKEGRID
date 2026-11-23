import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {cgLoadingStart, syncCrazyGamesData} from './game/crazygames';

// Hydrate CrazyGames SDK.data into localStorage before first render so
// returning players keep progress/unlocks. Safe no-op off-portal.
cgLoadingStart();
await syncCrazyGamesData();

createRoot(document.getElementById('root')!).render(<App />);
