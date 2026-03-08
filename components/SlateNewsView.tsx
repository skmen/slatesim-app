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
          <span className="text-[12px] text-ink/80 leading-snug">{inlineMd(trimmed.replace(/^[-*]\s+/, ''))}</span>
        </div>
      );
    } else if (trimmed === '') {
      nodes.push(<div key={key++} className="h-1.5" />);
    } else {
      nodes.push(
        <p key={key++} className="text-[12px] text-ink/80 leading-snug mb-1">
          {inlineMd(trimmed)}
        </p>
      );
    }
  }
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
    <div className="bg-white/60 border border-ink/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ink/10">
        <span className="text-base leading-none">{section.icon}</span>
        <span className="font-black uppercase tracking-tighter text-xs text-ink">{section.label}</span>
      </div>
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
      <div className="px-4 py-4 min-h-[80px]">
        {tabs[activeTab]
          ? renderMarkdown(tabs[activeTab])
          : <p className="text-[11px] text-ink/30 font-mono">No content for this tab.</p>
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

const UpdateItem: React.FC<{ update: BriefUpdate }> = ({ update }) => {
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
        <p className="text-[11px] font-black uppercase tracking-widest">Loading brief…</p>
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
  const regularSections = brief.sections.filter((s) => s.id !== 'exposure').sort((a, b) => a.order - b.order);
  const sortedUpdates = [...brief.updates].reverse();
  const tickerPlayers = brief.player_mentions.filter((m) => m.in_update);

  return (
    <div className="space-y-4">

      {/* Hero band */}
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

      {/* Exposure panel — full width below hero */}
      {exposureSection && <ExposurePanel section={exposureSection} />}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
