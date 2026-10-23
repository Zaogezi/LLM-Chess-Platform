import { BrandMark } from '../TopBar';

export function ModelLibraryHeader() {
  return (
    <header className="topbar library-topbar">
      <div className="topbar__main">
        <BrandMark />
        <h2 className="library-brand__title">模型库</h2>
      </div>
    </header>
  );
}
