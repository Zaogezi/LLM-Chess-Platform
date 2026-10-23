import { BrandMark } from '../TopBar';

export function AdminHeader() {
  return (
    <header className="topbar admin-topbar">
      <div className="topbar__main">
        <BrandMark />
        <h2 className="admin-brand__title">对局管理</h2>
      </div>
    </header>
  );
}
