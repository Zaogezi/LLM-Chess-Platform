import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp';
import App from './App';
import ChampionshipApp from './ChampionshipApp';
import ModelLibraryApp from './ModelLibraryApp';
import TournamentApp from './TournamentApp';
import WatchApp from './WatchApp';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('未找到 #root 挂载节点');
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : '/';
}

function selectPage(pathname: string) {
  switch (normalizePath(pathname)) {
    case '/tournament':
      return TournamentApp;
    case '/championship':
      return ChampionshipApp;
    case '/admin':
      return AdminApp;
    case '/models':
      return ModelLibraryApp;
    case '/watch':
      return WatchApp;
    default:
      return App;
  }
}

const Page = selectPage(window.location.pathname);

createRoot(container).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
