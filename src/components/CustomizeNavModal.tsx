import { useState } from 'react';
import {
  useNavStore,
  ALL_NAV_ITEMS,
} from '../store/navStore';
import type { NavItemId } from '../store/navStore';
import {
  Home,
  PieChart,
  List,
  Users,
  BarChart3,
  Target,
  Repeat,
  Settings as SettingsIcon,
  ArrowUp,
  ArrowDown,
  X,
  RotateCcw,
  SlidersHorizontal,
  Info,
  Check,
  MoreHorizontal,
} from 'lucide-react';

export default function CustomizeNavModal() {
  const {
    frontItemIds,
    isCustomizeModalOpen,
    setCustomizeModalOpen,
    moveToFront,
    moveToMore,
    moveItem,
    resetToDefault,
    getHiddenItemIds,
    getTotalBarCount,
  } = useNavStore();

  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  if (!isCustomizeModalOpen) return null;

  const hiddenItemIds = getHiddenItemIds();
  const totalCount = getTotalBarCount();
  const hasMore = hiddenItemIds.length > 0;

  const getIcon = (id: NavItemId | 'more' | 'settings') => {
    switch (id) {
      case 'home':
        return <Home size={16} />;
      case 'accounts':
        return <PieChart size={16} />;
      case 'activity':
        return <List size={16} />;
      case 'debts':
        return <Users size={16} />;
      case 'analytics':
        return <BarChart3 size={16} />;
      case 'goals':
        return <Target size={16} />;
      case 'recurring':
        return <Repeat size={16} />;
      case 'more':
        return <MoreHorizontal size={16} />;
      case 'settings':
        return <SettingsIcon size={16} />;
    }
  };

  const getItemLabel = (id: NavItemId) => {
    return ALL_NAV_ITEMS.find((item) => item.id === id)?.label || id;
  };

  const handleMoveToFront = (id: NavItemId) => {
    const success = moveToFront(id);
    if (!success) {
      setFeedbackMsg('Maximum 6 options allowed on the bottom bar.');
      setTimeout(() => setFeedbackMsg(null), 2500);
    }
  };

  const handleMoveToMore = (id: NavItemId) => {
    const success = moveToMore(id);
    if (!success) {
      setFeedbackMsg('Minimum 4 options required on the bottom bar.');
      setTimeout(() => setFeedbackMsg(null), 2500);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => setCustomizeModalOpen(false)}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent text-accent-foreground">
              <SlidersHorizontal size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-base">Customize Bottom Bar</h3>
              <p className="text-xs text-muted-foreground">
                Rearrange front items and hidden items (Min 4, Max 6 options)
              </p>
            </div>
          </div>
          <button
            onClick={() => setCustomizeModalOpen(false)}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Live Slot Preview & Counter */}
        <div className="p-4 bg-muted/20 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Bottom Bar Preview
            </span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                totalCount >= 4 && totalCount <= 6
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-500/10 text-amber-600'
              }`}
            >
              {totalCount} / 6 slots used
            </span>
          </div>

          <div className="flex items-center gap-1.5 p-2 bg-background/80 rounded-xl border border-border overflow-x-auto">
            {frontItemIds.map((id) => (
              <div
                key={id}
                className="flex-1 min-w-[50px] py-1.5 px-1 bg-accent/15 border border-accent/30 rounded-lg flex flex-col items-center justify-center text-accent"
              >
                {getIcon(id)}
                <span className="text-[10px] font-medium mt-1 truncate max-w-full">
                  {getItemLabel(id)}
                </span>
              </div>
            ))}
            {hasMore && (
              <div className="flex-1 min-w-[50px] py-1.5 px-1 bg-muted border border-border rounded-lg flex flex-col items-center justify-center text-muted-foreground">
                {getIcon('more')}
                <span className="text-[10px] font-medium mt-1">More</span>
              </div>
            )}
            <div className="flex-1 min-w-[50px] py-1.5 px-1 bg-muted border border-border rounded-lg flex flex-col items-center justify-center text-foreground font-medium">
              {getIcon('settings')}
              <span className="text-[10px] font-medium mt-1">Settings</span>
            </div>
          </div>

          {feedbackMsg && (
            <div className="mt-2.5 p-2 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg text-xs font-medium text-center animate-in fade-in">
              {feedbackMsg}
            </div>
          )}
        </div>

        {/* Content Lists */}
        <div className="p-5 max-h-[55vh] overflow-y-auto space-y-6">
          {/* Section 1: In Front */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                In Front ({frontItemIds.length})
              </span>
              <span className="text-[11px] text-muted-foreground">
                Appears directly on bottom bar
              </span>
            </div>
            <div className="space-y-1.5">
              {frontItemIds.map((id, index) => {
                const canMoveUp = index > 0;
                const canMoveDown = index < frontItemIds.length - 1;
                // If moving to more would make total count < 4, disable
                const canHide = getTotalBarCount(frontItemIds.filter((i) => i !== id)) >= 4;

                return (
                  <div
                    key={id}
                    className="flex items-center justify-between p-2.5 bg-muted/40 hover:bg-muted/60 border border-border rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-card text-foreground shadow-xs">
                        {getIcon(id)}
                      </div>
                      <span className="text-sm font-medium text-foreground">
                        {getItemLabel(id)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Reorder Buttons */}
                      <button
                        onClick={() => moveItem(id, 'up')}
                        disabled={!canMoveUp}
                        className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent"
                        title="Move Up"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => moveItem(id, 'down')}
                        disabled={!canMoveDown}
                        className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent"
                        title="Move Down"
                      >
                        <ArrowDown size={14} />
                      </button>

                      {/* Hide to More */}
                      <button
                        onClick={() => handleMoveToMore(id)}
                        disabled={!canHide}
                        className={`ml-2 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                          canHide
                            ? 'bg-card text-muted-foreground hover:text-foreground border border-border'
                            : 'opacity-30 cursor-not-allowed bg-muted text-muted-foreground'
                        }`}
                        title={canHide ? 'Move to More drawer' : 'Minimum 4 options required'}
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Hidden Under More */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Hidden Under More ({hiddenItemIds.length})
              </span>
              <span className="text-[11px] text-muted-foreground">
                Tucked into the More drawer
              </span>
            </div>

            {hiddenItemIds.length === 0 ? (
              <p className="text-xs text-muted-foreground italic p-3 bg-muted/20 rounded-xl text-center">
                All features are currently on the front bottom bar!
              </p>
            ) : (
              <div className="space-y-1.5">
                {hiddenItemIds.map((id) => {
                  // Check if moving to front would exceed max 6
                  const canShow = getTotalBarCount([...frontItemIds, id]) <= 6;

                  return (
                    <div
                      key={id}
                      className="flex items-center justify-between p-2.5 bg-muted/20 border border-border rounded-xl transition-colors"
                    >
                      <div className="flex items-center gap-2.5 opacity-80">
                        <div className="p-1.5 rounded-lg bg-card text-muted-foreground">
                          {getIcon(id)}
                        </div>
                        <span className="text-sm font-medium text-foreground">
                          {getItemLabel(id)}
                        </span>
                      </div>

                      <button
                        onClick={() => handleMoveToFront(id)}
                        disabled={!canShow}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                          canShow
                            ? 'bg-accent text-accent-foreground active:scale-95 shadow-xs'
                            : 'opacity-30 cursor-not-allowed bg-muted text-muted-foreground'
                        }`}
                        title={canShow ? 'Add to front bar' : 'Maximum 6 options reached'}
                      >
                        Show
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notice about Settings */}
          <div className="flex items-start gap-2 p-3 bg-muted/40 rounded-xl border border-border text-xs text-muted-foreground">
            <Info size={16} className="shrink-0 mt-0.5" />
            <p>
              <strong>Settings</strong> is always kept on the bottom bar for immediate access and
              cloud sync status. Total bar slots will always remain between 4 and 6.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/40 flex items-center justify-between">
          <button
            onClick={() => {
              resetToDefault();
              setFeedbackMsg('Restored default bottom bar layout.');
              setTimeout(() => setFeedbackMsg(null), 2000);
            }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-1"
          >
            <RotateCcw size={13} />
            <span>Reset to Default</span>
          </button>

          <button
            onClick={() => setCustomizeModalOpen(false)}
            className="flex items-center gap-1.5 px-4 py-2 bg-foreground text-background font-semibold rounded-xl text-xs active:scale-95 transition-transform"
          >
            <Check size={14} />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  );
}
