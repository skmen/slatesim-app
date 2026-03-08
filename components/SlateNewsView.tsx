import React, { useEffect, useState, useCallback } from 'react';
import { AlertCircle, RefreshCw, ChevronDown, ChevronUp, Newspaper } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BriefSection {
  id: string;
  label: string;
  icon: string;
  content: string;
  summary: string;
  order: number;
}

interface BriefUpdate {
  timestamp: string;
  category: string;
  label: string;
  icon: string;
  severity: 'high' | 'medium' | 'low' | 'none';
  headline: string;
  content: string;
}

interface PlayerMention {
  player_name: string;
  team_abbr: string | null;
  context: string;
  section_id: string;
  in_update: boolean;
}

interface BriefMeta {
  section_count: number;
  update_count: number;
  player_mention_count: number;
  high_severity_count: number;
  has_updates: boolean;
}

interface ParsedBrief {
  slate_date: string;
  generated_at: string | null;
  last_updated_at: string | null;
  update_count: number;
  sections: BriefSection[];
  updates: BriefUpdate[];
  player_mentions: PlayerMention[];
  meta: BriefMeta;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#6B7280',
  none: '#6B7280',
};

const SEVERITY_LABEL: Record<string, string> = {
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
  none: '',
};

// Exposure tab definitions — matched against markdown headings
const EXPOSURE_TABS = [
  { key: 'target',   label: '🔼 Target',       anchor: 'Increase Exposure' },
  { key: 'fade',     label: '🔽 Fade',          anchor: 'Reduce Exposure' },
  { key: 'leverage', label: '⚖️ Leverage',      anchor: 'Ownership Leverage' },
  { key: 'injury',   label: '⚠️ Injury Watch',  anchor: 'Injury' },
  { key: 'stacks',   label: '📊 Stacks',         anchor: 'Game Stack' },
] as const;

type ExposureTabKey = typeof EXPOSURE_TABS[number]['key'];

function formatSlateDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (!Number.isFinite(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/**
 * Split exposure section markdown into per-tab content by heading anchors.
 * Returns a map of tab key → markdown text for that subsection.
 */
function parseExposureTabs(content: string): Record<ExposureTabKey, string> {
  const result = {} as Record<ExposureTabKey, string>;
  // Split on any ## / ### heading
  const chunks = content.split(/\n(?=#{2,3}\s)/);

  for (const tab of EXPOSURE_TABS) {
    const chunk = chunks.find((c) =>
      c.match(new RegExp(`^#{2,3}\\s+.*${tab.anchor}`, 'i'))
    );
    result[tab.key] = chunk
      ? chunk.replace(/^#{2,3}\s+[^\n]+\n?/, '').trim()
      : '';
  }
  return result;
}

/** Minimal markdown → React: handles headers, bullets, bold, italic. */
function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split('\n');
  const nodes: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,3}\s/.test(trimmed)) {
      nodes.push(
        <p key={key++} className="font-black uppercase tracking-tighter text-xs text-ink/70 mt-3 mb-1">
          {trimmed.replace(/^#{1,3}\s+/, '')}
        </p>
      );
    } else if (/^[-*]\s/.test(trimmed)) {
      nodes.push(
        <div key={key++} className="flex gap-1.5 items-start ml-2 mb-0.5">
          <span className="text-drafting-orange mt-0.5 text-[10px] shrink-0">▪</span>
          <span className="text-[12px] text-ink/80 leading-snug">{inlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}</span>
        </div>
      );
    } else if (trimmed === '') {
      nodes.push(<div key={key++} className="h-1.5" />);
    } else {
      nodes.push(
        <p key={key++} className="text-[12px] text-ink/80 leading-snug mb-1">
          {inlineMarkdown(trimmed)}
        </p>
      );
    }
  }
  return <>{nodes}</>;
}

function inlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-black text-ink">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

// ─── ExposurePanel ────────────────────────────────────────────────────────────

interface ExposurePanelProps {
  section: BriefSection;
}

const ExposurePanel: React.FC<ExposurePanelProps> = ({ section }) => {
  const [activeTab, setActiveTab] = useState<ExposureTabKey>('target');
  const tabs = parseExposureTabs(section.content);

  return (
    <div className="bg-white/60 border border-ink/10 rounded-xl overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ink/10">
        <span className="text-base leading-none">{section.icon}</span>
        <span className="font-black uppercase tracking-tighter text-xs text-ink">{section.label}</span>
      </div>

      {/* Tab bar */}
      <div className="flex overflow-x-auto border-b border-ink/10 bg-ink/[0.02]">
        {EXPOSURE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 px-3 py-2 text-[10px] font-black uppercase tracking-tighter whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'border-drafting-orange text-drafting-orange'
                : 'border-transparent text-ink/40 hover:text-ink/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 py-4 min-h-[80px]">
        {tabs[activeTab]
          ? renderMarkdown(tabs[activeTab])
          : <p className="text-[11px] text-ink/30 font-mono">No content for this section.</p>
        }
      </div>
    </div>
  );
};

// ─── SectionCard ──────────────────────────────────────────────────────────────

interface SectionCardProps {
  section: BriefSection;
  defaultExpanded?: boolean;
}

const SectionCard: React.FC<SectionCardProps> = ({ section, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="bg-white/60 border border-ink/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-ink/5 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{section.icon}</span>
          <span className="font-black uppercase tracking-tighter text-xs text-ink">{section.label}</span>
        </div>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-ink/40 shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-ink/40 shrink-0" />
        }
      </button>

      {!expanded && section.summary && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-[11px] text-ink/60 leading-snug">{section.summary}</p>
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4 border-t border-ink/5 pt-3">
          {renderMarkdown(section.content)}
        </div>
      )}
    </div>
  );
};

// ─── UpdateItem ───────────────────────────────────────────────────────────────

interface UpdateItemProps {
  update: BriefUpdate;
}

const UpdateItem: React.FC<UpdateItemProps> = ({ update }) => {
  const [expanded, setExpanded] = useState(false);
  const borderColor = SEVERITY_COLOR[update.severity] ?? SEVERITY_COLOR.none;
  const severityLabel = SEVERITY_LABEL[update.severity];

  return (
    <div
      className="bg-white/60 border border-ink/10 rounded-xl overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
    >
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full text-left px-4 py-3 hover:bg-ink/5 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-[11px] text-ink/40 font-mono">{update.timestamp}</span>
              <span className="text-[10px]">{update.icon}</span>
              <span className="text-[10px] font-black uppercase tracking-tighter text-ink/50">{update.label}</span>
              {severityLabel && (
                <span
                  className="text-[9px] font-black px-1 py-0.5 rounded uppercase tracking-widest text-white"
                  style={{ backgroundColor: borderColor }}
                >
                  {severityLabel}
                </span>
              )}
            </div>
            <p className="font-bold text-[12px] text-ink leading-tight">{update.headline}</p>
          </div>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-ink/40 shrink-0 mt-1" />
            : <ChevronDown className="w-3.5 h-3.5 text-ink/40 shrink-0 mt-1" />
          }
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-ink/5 pt-3">
          {renderMarkdown(update.content)}
        </div>
      )}
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  slateDate: string;
}

const SlateNewsView: React.FC<Props> = ({ slateDate }) => {
  const [brief, setBrief] = useState<ParsedBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBrief = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBrief(null);
    try {
      const resp = await fetch(`/api/brief?date=${slateDate}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError((body as any)?.error ?? `HTTP ${resp.status}`);
        return;
      }
      setBrief(await resp.json());
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  }, [slateDate]);

  useEffect(() => { fetchBrief(); }, [fetchBrief]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-ink/40">
        <RefreshCw className="w-6 h-6 animate-spin" />
        <p className="text-[11px] font-black uppercase tracking-widest">Parsing brief…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <AlertCircle className="w-6 h-6 text-red-400" />
        <p className="text-[11px] font-black uppercase tracking-widest text-red-400">{error}</p>
        <button
          onClick={fetchBrief}
          className="text-[10px] font-black border border-ink/20 px-3 py-1.5 rounded uppercase tracking-widest hover:border-drafting-orange hover:text-drafting-orange transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!brief) return null;

  const exposureSection = brief.sections.find((s) => s.id === 'exposure');
  const regularSections = brief.sections
    .filter((s) => s.id !== 'exposure')
    .sort((a, b) => a.order - b.order);
  const sortedUpdates = [...brief.updates].reverse();
  const tickerPlayers = brief.player_mentions.filter((m) => m.in_update);

  return (
    <div className="space-y-4">

      {/* ── Hero band ────────────────────────────────────────────────────── */}
      <div className="bg-white/60 border border-ink/10 rounded-xl px-5 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Newspaper className="w-4 h-4 text-drafting-orange" />
              <span className="font-black uppercase tracking-tighter text-xs text-ink/50">Slate News</span>
            </div>
            <h2 className="font-black text-xl tracking-tighter italic text-ink uppercase leading-none">
              {formatSlateDate(brief.slate_date)}
            </h2>
            <p className="text-[11px] text-ink/50 mt-1 font-mono">
              {brief.last_updated_at ? `Last updated ${brief.last_updated_at}` : 'No updates yet'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {brief.meta.update_count > 0 && (
              <span className="text-[10px] font-black px-2 py-1 rounded-full bg-ink/10 text-ink uppercase tracking-widest">
                {brief.meta.update_count} update{brief.meta.update_count !== 1 ? 's' : ''}
              </span>
            )}
            {brief.meta.high_severity_count > 0 && (
              <span
                className="text-[10px] font-black px-2 py-1 rounded-full text-white uppercase tracking-widest"
                style={{ backgroundColor: SEVERITY_COLOR.high }}
              >
                {brief.meta.high_severity_count} high severity
              </span>
            )}
          </div>
        </div>

        {/* Player ticker */}
        {tickerPlayers.length > 0 && (
          <div className="mt-3 pt-3 border-t border-ink/10">
            <p className="text-[9px] font-black uppercase tracking-widest text-ink/40 mb-2">In Updates</p>
            <div className="flex flex-wrap gap-1.5">
              {tickerPlayers.map((m, i) => (
                <span
                  key={i}
                  title={m.context}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-drafting-orange/10 border border-drafting-orange/20 text-drafting-orange cursor-default"
                >
                  {m.player_name}
                  {m.team_abbr && <span className="text-ink/40 ml-1">{m.team_abbr}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Exposure panel (full-width, below hero) ───────────────────────── */}
      {exposureSection && <ExposurePanel section={exposureSection} />}

      {/* ── Two-column layout ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* Left — initial brief sections */}
        <div className="space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-ink/40 px-1">Pre-Slate Brief</p>
          {regularSections.map((section) => (
            <SectionCard
              key={section.id + section.order}
              section={section}
              defaultExpanded={section.id === 'overview'}
            />
          ))}
        </div>

        {/* Right — update timeline */}
        <div className="space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-ink/40 px-1">
            Live Updates
            {sortedUpdates.length === 0 && (
              <span className="text-ink/30 ml-2 normal-case font-normal tracking-normal">— none yet</span>
            )}
          </p>
          {sortedUpdates.length === 0 ? (
            <div className="bg-white/40 border border-ink/10 rounded-xl px-5 py-8 text-center">
              <p className="text-[11px] text-ink/30 font-mono">No updates for this slate yet.</p>
            </div>
          ) : (
            sortedUpdates.map((update, i) => <UpdateItem key={i} update={update} />)
          )}
        </div>
      </div>
    </div>
  );
};

export default SlateNewsView;
