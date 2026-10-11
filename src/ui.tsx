import { useState } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

// ---------- 共通の小さな部品（アイコンだけのボタン・「…」メニュー） ----------

export function IconButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button className="icon-btn" type="button" aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export type MenuItem = {
  label: string;
  icon: IconName;
  danger?: boolean;
  onSelect: () => void;
};

// 行の右にある「…」メニュー。まれにしか使わない操作（編集・削除・取り消しなど）を入れる
export function OverflowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-wrap">
      <IconButton icon="more" label={label} onClick={() => setOpen((value) => !value)} />
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            {items.map((item) => (
              <button
                className={item.danger ? "menu-item danger" : "menu-item"}
                key={item.label}
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
