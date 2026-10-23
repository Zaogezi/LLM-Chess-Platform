export type AppPage = 'arena' | 'tournament' | 'championship' | 'models' | 'admin';

interface NavItem {
  page: AppPage;
  href: string;
  label: string;
  title: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { page: 'arena', href: '/', label: '棋盘', title: '观战棋盘' },
  { page: 'tournament', href: '/tournament', label: '自动评测', title: '多模型自动评测' },
  { page: 'championship', href: '/championship', label: '锦标赛', title: '十六强锦标赛' },
  { page: 'models', href: '/models', label: '模型库', title: '模型配置库' },
  { page: 'admin', href: '/admin', label: '对局管理', title: '历史对局管理' },
];

/**
 * Fixed page switcher pinned to the top of the viewport. Labels only; the
 * active page is communicated by the aria-current state and a quiet highlight.
 */
export function FixedNav({ current }: { current: AppPage }) {
  return (
    <nav className="fixed-nav" aria-label="固定页面导航">
      {NAV_ITEMS.map((item) => {
        const active = item.page === current;
        return (
          <a
            key={item.page}
            href={item.href}
            className={`fixed-nav__btn${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
            aria-label={item.title}
            title={item.title}
          >
            <span className="fixed-nav__label">{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
