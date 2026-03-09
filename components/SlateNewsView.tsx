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

interface ParsedBrief {
  slate_date: string;
  last_updated_at: string | null;
  sections: BriefSection[];
  updates: BriefUpdate[];
  player_mentions: PlayerMention[];
  meta: {
    section_count: number;
    update_count: number;
    high_severity_count: number;
    has_updates: boolean;
  };
}

// ─── Category definitions ─────────────────────────────────────────────────────

const CATEGORIES = [
  {
    id: 'injuries',
    label: 'Injury Report',
    icon: '🩹',
    keywords: ['out', 'questionable', 'doubtful', 'gtd', 'injury', 'injured', 'inactive',
               'ruled out', 'upgraded', 'cleared', 'dnp', 'health', 'will not play',
               'out tonight', 'scratched'],
  },
  {
    id: 'referees',
    label: 'Officials',
    icon: '🦺',
    keywords: ['referee', 'crew', 'foul', 'officiating', 'fta', 'calls', 'whistles'],
  },
  {
    id: 'coaches',
    label: 'Rotations',
    icon: '📋',
    keywords: ['coach', 'rotation', 'bench', 'starter', 'minutes', 'substitution',
               'depth chart', 'lineup', 'blowout'],
  },
  {
    id: 'totals',
    label: 'Game Environment',
    icon: '📊',
    keywords: ['total', 'over/under', 'o/u', 'spread', 'line', 'odds', 'implied',
               'vegas', 'pace', 'points'],
  },
  {
    id: 'exposure',
    label: 'Exposure Recommendations',
    icon: '🎯',
    keywords: ['exposure', 'increase exposure', 'reduce exposure', 'fade', 'target',
               'leverage', 'stack', 'ownership', 'gpp', 'overweight', 'underweight',
               'differentiator', 'hvm', 'ceiling', 'salary'],
  },
] as const;

type CategoryId = typeof CATEGORIES[number]['id'] | 'overview';

const OVERVIEW_CATEGORY = { id: 'overview' as const, label: 'Overview', icon: '📰' };

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

const EXPOSURE_TABS = [
  { key: 'target',   label: '🔼 Target',      anchor: /increase exposure/i },
  { key: 'fade',     label: '🔽 Fade',         anchor: /reduce exposure/i },
  { key: 'leverage', label: '⚖️ Leverage',     anchor: /ownership leverage/i },
  { key: 'injury',   label: '⚠️ Injury Watch', anchor: /injury/i },
  { key: 'stacks',   label: '📊 Stacks',        anchor: /game stack/i },
] as const;

type ExposureTabKey = typeof EXPOSURE_TABS[number]['key'];

// ─── Rule-based parser ────────────────────────────────────────────────────────

function classifyText(text: string): typeof CATEGORIES[number] | typeof OVERVIEW_CATEGORY {
  const lower = text.toLowerCase();
  let best = OVERVIEW_CATEGORY as any;
  let bestCount = 0;

  for (const cat of CATEGORIES) {
    const count = cat.keywords.filter((kw) => lower.includes(kw)).length;
    if (count > bestCount) {
      bestCount = count;
      best = cat;
    }
  }
  return best;
}

function getSeverity(text: string): 'high' | 'medium' | 'low' | 'none' {
  const lower = text.toLowerCase();
  if (/ruled out|out tonight|scratched|will not play/.test(lower)) return 'high';
  if (/questionable|gtd|upgraded|downgraded/.test(lower)) return 'medium';
  if (/probable|listed|expected|trending/.test(lower)) return 'low';
  return 'none';
}

function extractDateFromH1(line: string): string | null {
  const m = line.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function extractUpdateTimestamp(line: string): string | null {
  // Matches "### 🔄 Update — 14:32 PST" or "### Update — 2:32 PM PST"
  const m = line.match(/update\s*[—\-]\s*(.+?)(?:\s*pst)?$/i);
  return m ? m[1].trim() : null;
}

function makeHeadline(content: string): string {
  // Take first non-empty sentence or first line, cap at 12 words
  const first = content
    .replace(/^#{1,3}\s+[^\n]+\n?/, '') // strip leading heading
    .replace(/\*\*/g, '')
    .split(/[.\n]/)[0]
    .trim();
  const words = first.split(/\s+/).slice(0, 12);
  return words.join(' ') + (words.length < first.split(/\s+/).length ? '…' : '');
}

function makeSummary(content: string): string {
  return content
    .replace(/^#{1,3}\s+[^\n]+\n?/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 180)
    .trim();
}

/** Very light player-name detection: capitalised First Last pairs. */
function extractPlayerMentions(
  content: string,
  sectionId: string,
  inUpdate: boolean
): PlayerMention[] {
  const mentions: PlayerMention[] = [];
  const seen = new Set<string>();
  // Match "Firstname Lastname" — both capitalised, preceded by space/newline/bullet
  const re = /(?:^|[\s*\-•])([A-Z][a-z]+(?:\s[A-Z][a-z']+)+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].trim();
    if (seen.has(name)) continue;
    // Skip common false-positives (headings, labels)
    if (/^(The|This|In|For|On|At|All|Key|Game|Last|Next|Week|Note|NBA|DFS|GPP|GTD|DNP)/.test(name)) continue;
    seen.add(name);
    // Try to extract team abbr — look for (XXX) immediately after the name
    const teamMatch = content.slice(m.index).match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(([A-Z]{2,4})\\)`));
    mentions.push({
      player_name: name,
      team_abbr: teamMatch ? teamMatch[1] : null,
      context: makeSummary(content).slice(0, 120),
      section_id: sectionId,
      in_update: inUpdate,
    });
  }
  return mentions;
}

function parseBriefMarkdown(md: string): ParsedBrief {
  // Split into blocks on horizontal rules
  const blocks = md.split(/\n---+\n/);
  const initialBlock = blocks[0] ?? '';
  const updateRawBlocks = blocks.slice(1);

  // ── Slate date from H1 ──────────────────────────────────────────────────
  let slateDate = new Date().toISOString().slice(0, 10);
  for (const line of initialBlock.split('\n')) {
    if (line.startsWith('# ')) {
      const d = extractDateFromH1(line);
      if (d) { slateDate = d; break; }
    }
  }

  // ── Initial sections: split on ## / ### headings ─────────────────────
  const sections: BriefSection[] = [];
  const initialLines = initialBlock.split('\n');
  let currentHeading = '';
  let currentLines: string[] = [];
  let order = 0;

  const flushSection = () => {
    const raw = currentLines.join('\n').trim();
    if (!raw) return;
    const fullText = currentHeading ? `${currentHeading}\n${raw}` : raw;
    // Skip if it's just the H1 title
    if (/^#\s/.test(fullText.split('\n')[0])) return;
    const cat = classifyText(fullText);
    sections.push({
      id: cat.id,
      label: cat.label,
      icon: cat.icon,
      content: fullText,
      summary: makeSummary(raw),
      order: order++,
    });
  };

  for (const line of initialLines) {
    if (/^##\s/.test(line) || /^###\s/.test(line)) {
      flushSection();
      currentHeading = line;
      currentLines = [];
    } else if (/^#\s/.test(line)) {
      // H1 — skip into next section
      currentHeading = '';
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flushSection();

  // If no sub-sections were found, treat entire initial block (minus H1) as one overview section
  if (sections.length === 0) {
    const body = initialLines.filter((l) => !/^#\s/.test(l)).join('\n').trim();
    if (body) {
      sections.push({
        id: 'overview',
        label: 'Overview',
        icon: '📰',
        content: body,
        summary: makeSummary(body),
        order: 0,
      });
    }
  }

  // ── Update blocks ────────────────────────────────────────────────────
  const updates: BriefUpdate[] = [];
  let lastTimestamp: string | null = null;

  for (const raw of updateRawBlocks) {
    const lines = raw.trim().split('\n');
    let timestamp = '';
    let contentStartIdx = 0;

    for (let i = 0; i < lines.length; i++) {
      const ts = extractUpdateTimestamp(lines[i]);
      if (ts) {
        timestamp = ts;
        lastTimestamp = ts;
        contentStartIdx = i + 1;
        break;
      }
    }

    const content = lines.slice(contentStartIdx).join('\n').trim();
    if (!content) continue;

    const cat = classifyText(content);
    const severity = getSeverity(content);

    updates.push({
      timestamp,
      category: cat.id,
      label: cat.label,
      icon: cat.icon,
      severity,
      headline: makeHeadline(content),
      content,
    });
  }

  // ── Player mentions ──────────────────────────────────────────────────
  const playerMentions: PlayerMention[] = [];
  for (const sec of sections) {
    playerMentions.push(...extractPlayerMentions(sec.content, sec.id, false));
  }
  for (const upd of updates) {
    playerMentions.push(...extractPlayerMentions(upd.content, upd.category, true));
  }

  const highCount = updates.filter((u) => u.severity === 'high').length;

  return {
    slate_date: slateDate,
    last_updated_at: lastTimestamp,
    sections,
    updates,
    player_mentions: playerMentions,
    meta: {
      section_count: sections.length,
      update_count: updates.length,
      high_severity_count: highCount,
      has_updates: updates.length > 0,
    },
  };
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split('\n');
  const nodes: React.ReactNode[] = [];
  let key = 0;
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    nodes.push(
      <ul key={key++} className="space-y-1.5 pl-5 list-disc marker:text-drafting-orange">
        {items.map((item, idx) => (
          <li key={`${key}-${idx}`} className="text-sm text-ink/85 leading-6">
            {inlineMd(item)}
          </li>
        ))}
      </ul>
    );
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,3}\s/.test(trimmed)) {
      flushList();
      const level = (trimmed.match(/^#{1,3}/)?.[0].length ?? 2);
      nodes.push(
        <p
          key={key++}
          className={`font-semibold text-ink mt-4 mb-1 ${
            level === 1 ? 'text-base' : level === 2 ? 'text-sm' : 'text-sm text-ink/80'
          }`}
        >
          {trimmed.replace(/^#{1,3}\s+/, '')}
        </p>
      );
    } else if (/^[-*]\s/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
    } else if (trimmed === '') {
      flushList();
      nodes.push(<div key={key++} className="h-1" />);
    } else {
      flushList();
      nodes.push(
        <p key={key++} className="text-sm text-ink/85 leading-6">
          {inlineMd(trimmed)}
        </p>
      );
    }
  }
  flushList();
  return <>{nodes}</>;
}

function inlineMd(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-black text-ink">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

// ─── Exposure tab parser ──────────────────────────────────────────────────────

function parseExposureTabs(content: string): Record<ExposureTabKey, string> {
  const result = {} as Record<ExposureTabKey, string>;
  const chunks = content.split(/\n(?=#{2,3}\s)/);

  for (const tab of EXPOSURE_TABS) {
    const chunk = chunks.find((c) => tab.anchor.test(c.split('\n')[0]));
    result[tab.key] = chunk
      ? chunk.replace(/^#{2,3}\s+[^\n]+\n?/, '').trim()
      : '';
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSlateDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (!Number.isFinite(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const ExposurePanel: React.FC<{ section: BriefSection }> = ({ section }) => {
  const [activeTab, setActiveTab] = useState<ExposureTabKey>('target');
  const tabs = parseExposureTabs(section.content);

  return (
    <div className="bg-white/75 border border-ink/10 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-ink/10 bg-white/70">
        <span className="text-base leading-none">{section.icon}</span>
        <span className="font-semibold text-sm text-ink">{section.label}</span>
      </div>
      <div className="flex overflow-x-auto border-b border-ink/10 bg-ink/[0.02]">
        {EXPOSURE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'border-drafting-orange text-drafting-orange'
                : 'border-transparent text-ink/40 hover:text-ink/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="px-5 py-5 min-h-[96px]">
        {tabs[activeTab]
          ? renderMarkdown(tabs[activeTab])
          : <p className="text-sm text-ink/35">No content for this tab.</p>
        }
      </div>
    </div>
  );
};

const SectionCard: React.FC<{ section: BriefSection; defaultExpanded?: boolean }> = ({
  section,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="bg-white/75 border border-ink/10 rounded-2xl overflow-hidden shadow-sm">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-ink/5 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{section.icon}</span>
          <span className="font-semibold text-sm text-ink">{section.label}</span>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-ink/40 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-ink/40 shrink-0" />
        }
      </button>
      {!expanded && section.summary && (
        <div className="px-5 pb-4 -mt-1">
          <p className="text-sm text-ink/65 leading-6">{section.summary}</p>
        </div>
      )}
      {expanded && (
        <div className="px-5 pb-5 border-t border-ink/5 pt-4">
          <div className="max-w-3xl">
            {renderMarkdown(section.content)}
          </div>
        </div>
      )}
    </div>
  );
};

const UpdateItem: React.FC<{ update: BriefUpdate }> = ({ update }) => {
  const [expanded, setExpanded] = useState(false);
  const borderColor = SEVERITY_COLOR[update.severity] ?? SEVERITY_COLOR.none;
  const severityLabel = SEVERITY_LABEL[update.severity];

  return (
    <div
      className="bg-white/75 border border-ink/10 rounded-2xl overflow-hidden shadow-sm"
      style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
    >
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full text-left px-5 py-4 hover:bg-ink/5 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs text-ink/45 font-mono">{update.timestamp}</span>
              <span className="text-xs">{update.icon}</span>
              <span className="text-xs font-semibold text-ink/60">{update.label}</span>
              {severityLabel && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide text-white"
                  style={{ backgroundColor: borderColor }}
                >
                  {severityLabel}
                </span>
              )}
            </div>
            <p className="font-semibold text-sm text-ink leading-6">{update.headline}</p>
          </div>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-ink/40 shrink-0 mt-1" />
            : <ChevronDown className="w-4 h-4 text-ink/40 shrink-0 mt-1" />
          }
        </div>
      </button>
      {expanded && (
        <div className="px-5 pb-5 border-t border-ink/5 pt-4">
          <div className="max-w-3xl">
            {renderMarkdown(update.content)}
          </div>
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
      const md = await resp.text();
      setBrief(parseBriefMarkdown(md));
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
        <p className="text-sm font-semibold">Loading brief…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <AlertCircle className="w-6 h-6 text-red-400" />
        <p className="text-sm font-semibold text-red-500">{error}</p>
        <button
          onClick={fetchBrief}
          className="text-xs font-semibold border border-ink/20 px-3 py-1.5 rounded-md hover:border-drafting-orange hover:text-drafting-orange transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!brief) return null;

  const exposureSection = brief.sections.find((s) => s.id === 'exposure');
  const regularSections = brief.sections.filter((s) => s.id !== 'exposure').sort((a, b) => a.order - b.order);
  const sortedUpdates = [...brief.updates].reverse();
  const tickerPlayers = brief.player_mentions.filter((m) => m.in_update);
  const tickerPlayerNames = Array.from(
    new Set(
      tickerPlayers.map((m) => (m.team_abbr ? `${m.player_name} (${m.team_abbr})` : m.player_name))
    )
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">

      {/* Hero band */}
      <div className="bg-white/80 border border-ink/10 rounded-2xl px-6 py-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <Newspaper className="w-4 h-4 text-drafting-orange" />
              <span className="text-sm font-semibold text-ink/60">Slate News</span>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink leading-tight">
              {formatSlateDate(brief.slate_date)}
            </h2>
            <p className="text-sm text-ink/55 mt-1">
              {brief.last_updated_at ? `Last updated ${brief.last_updated_at}` : 'No updates yet'}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 w-full lg:w-auto">
            <div className="bg-ink/[0.03] rounded-lg border border-ink/10 px-3 py-2">
              <p className="text-[11px] text-ink/50">Updates</p>
              <p className="text-base font-semibold text-ink">{brief.meta.update_count}</p>
            </div>
            <div className="bg-ink/[0.03] rounded-lg border border-ink/10 px-3 py-2">
              <p className="text-[11px] text-ink/50">High severity</p>
              <p className="text-base font-semibold" style={{ color: brief.meta.high_severity_count ? SEVERITY_COLOR.high : 'inherit' }}>
                {brief.meta.high_severity_count}
              </p>
            </div>
            <div className="bg-ink/[0.03] rounded-lg border border-ink/10 px-3 py-2 col-span-2 sm:col-span-1">
              <p className="text-[11px] text-ink/50">Sections</p>
              <p className="text-base font-semibold text-ink">{brief.meta.section_count}</p>
            </div>
          </div>
        </div>

        {tickerPlayerNames.length > 0 && (
          <div className="mt-4 pt-4 border-t border-ink/10">
            <p className="text-xs font-semibold text-ink/55 mb-1.5">Players mentioned in updates</p>
            <p className="text-sm text-ink/75 leading-6">
              {tickerPlayerNames.slice(0, 18).join(' • ')}
              {tickerPlayerNames.length > 18 ? ` • +${tickerPlayerNames.length - 18} more` : ''}
            </p>
          </div>
        )}
      </div>

      {/* Exposure panel — full width below hero */}
      {exposureSection && <ExposurePanel section={exposureSection} />}

      {/* Main content layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <section className="space-y-3">
          <p className="text-sm font-semibold text-ink/55 px-1">Pre-slate brief</p>
          {regularSections.length === 0 && (
            <div className="bg-white/60 border border-ink/10 rounded-2xl px-5 py-6">
              <p className="text-sm text-ink/45">No pre-slate sections available.</p>
            </div>
          )}
          {regularSections.map((section) => (
            <SectionCard
              key={section.id + section.order}
              section={section}
              defaultExpanded={section.id === 'overview'}
            />
          ))}
        </section>

        <section className="space-y-3">
          <p className="text-sm font-semibold text-ink/55 px-1">
            Live Updates
            {sortedUpdates.length === 0 && (
              <span className="text-ink/35 ml-2 normal-case font-normal tracking-normal">No updates yet</span>
            )}
          </p>
          {sortedUpdates.length === 0 ? (
            <div className="bg-white/60 border border-ink/10 rounded-2xl px-5 py-8 text-center">
              <p className="text-sm text-ink/40">No updates for this slate yet.</p>
            </div>
          ) : (
            sortedUpdates.map((update, i) => <UpdateItem key={i} update={update} />)
          )}
        </section>
      </div>
    </div>
  );
};

export default SlateNewsView;
