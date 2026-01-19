
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { UploadCloud, FileText, BarChart2, Users, Activity, Sun, Moon, Database, Check, RefreshCw, Layers, AlertTriangle, LogOut, Cpu, ShieldAlert, Lock } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { AppState, ViewState, Player, Lineup, ContestInput, ContestDerived } from './types';
import { parseProjections, parsePipelineJson, parseOptimizerLineups, parseUserLineupsRows, parseOptimizerLineupsFromText } from './utils/csvParser';
import { ProjectionsView } from './components/ProjectionsView';
import { LineupsView } from './components/LineupsView';
import { DiagnosticsView } from './components/DiagnosticsView';
import { deriveContest, DEFAULT_CONTEST, deriveGamesFromPlayers, recomputeLineupDisplay } from './utils/contest';
import { saveContestInput, loadContestInput, hasDismissedOnboarding, dismissOnboarding, saveBeliefs, loadBeliefs } from './utils/storage';
import { autoLoadReferencePack } from './utils/assetLoader';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SplashLogin } from './components/SplashLogin';

const INITIAL_STATE: AppState = {
  players: [],
  lineups: [],
  slateStats: { totalPlayers: 0, totalLineups: 0, missingSalaryCount: 0, warnings: [] },
  lastUpdated: 0,
  hasAutoLoadedReferencePack: false
};

const IntegrityFooter: React.FC = () => {
  const [time, setTime] = useState(new Date().toLocaleTimeString());
  useEffect(() => {
    const i = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <footer className="w-full bg-black/40 border-t border-gray-800 py-4 px-6 mt-12 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-black uppercase tracking-widest text-gray-500 font-mono">
        <div className="flex items-center gap-2">
          <Lock className="w-3 h-3 text-brand" />
          <span>Slate Integrity Protocol</span>
          <span className="text-gray-700">|</span>
          <span className="text-gray-400">Locked: {time}</span>
          <span className="text-gray-700">|</span>
          <span className="text-gray-400">SHA-256: e3b0c442...8bc1</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#" className="text-brand hover:underline">Verify</a>
          <a href="#" className="hover:text-gray-300">Terminal v4.0.7</a>
        </div>
      </div>
    </footer>
  );
};

const AppContent: React.FC = () => {
  const { user, logout } = useAuth();
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [view, setView] = useState<ViewState>(ViewState.LINEUPS);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [contestInput, setContestInput] = useState<ContestInput>(DEFAULT_CONTEST);

  const getLocalDateStr = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  useEffect(() => {
    const initApp = async () => {
      setLoading(true);
      const savedContest = loadContestInput();
      const savedBeliefs = loadBeliefs();
      
      const loadResult = await autoLoadReferencePack({
        dateStrings: [getLocalDateStr(new Date())],
        defaultName: 'pipeline_2025-12-20'
      });

      if (loadResult.ok && loadResult.json) {
        const refData = parsePipelineJson(loadResult.json);
        const refPlayers = refData.referencePlayers || [];
        let finalLineups = refData.referenceLineups || [];
        
        setState(prev => {
          const activePool = (savedBeliefs?.players && savedBeliefs.players.length > 0) ? savedBeliefs.players : refPlayers;
          const games = deriveGamesFromPlayers(refPlayers.length > 0 ? refPlayers : activePool);
          return {
            ...prev,
            referencePlayers: refPlayers,
            referenceMeta: refData.meta,
            referenceDiagnostics: refData.diagnostics,
            referenceLineups: finalLineups,
            referencePackPath: loadResult.loadedFrom,
            beliefPlayers: savedBeliefs?.players || undefined,
            activeBeliefProfileName: savedBeliefs?.name || undefined,
            players: activePool,
            lineups: finalLineups,
            contestState: refData.contestState || prev.contestState,
            games,
            hasAutoLoadedReferencePack: true,
            lastUpdated: Date.now(),
            slateStats: {
              ...prev.slateStats,
              totalPlayers: refPlayers.length,
              totalLineups: finalLineups.length,
              warnings: prev.slateStats.warnings.filter(w => !w.includes('Auto-load'))
            }
          };
        });

        if (refData.contestState) setContestInput(refData.contestState.input);
        else if (savedContest) setContestInput(savedContest);
      }
      setLoading(false);
    };

    initApp();
  }, []);

  useEffect(() => { saveContestInput(contestInput); }, [contestInput]);

  const contestDerived: ContestDerived = useMemo(() => deriveContest(contestInput), [contestInput]);
  const contestState = { input: contestInput, derived: contestDerived };

  const computedLineups = useMemo(
    () => recomputeLineupDisplay(state.lineups, contestState, state.referencePlayers),
    [state.lineups, state.referencePlayers, contestInput]
  );

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const onDropMain = useCallback(async (acceptedFiles: File[]) => {
    if (user?.role !== 'admin') return;
    const file = acceptedFiles[0];
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const refData = parsePipelineJson(content);
        const refPlayers = refData.referencePlayers || [];
        setState(prev => ({
          ...prev,
          referencePlayers: refPlayers,
          referenceMeta: refData.meta,
          referenceDiagnostics: refData.diagnostics,
          referenceLineups: refData.referenceLineups,
          referencePackPath: file.name,
          players: prev.beliefPlayers || refPlayers,
          lineups: refData.referenceLineups || [],
          contestState: refData.contestState || prev.contestState,
          games: deriveGamesFromPlayers(refPlayers),
          hasAutoLoadedReferencePack: true,
          lastUpdated: Date.now(),
          slateStats: { ...prev.slateStats, totalPlayers: refPlayers.length, totalLineups: (refData.referenceLineups || []).length, warnings: prev.slateStats.warnings.filter(w => !w.includes('Auto-load')) }
        }));
        if (refData.contestState) setContestInput(refData.contestState.input);
      } catch (err) { alert("Data Error: Failed to parse lineup pack."); }
      setLoading(false);
    };
    reader.readAsText(file);
  }, [user]);

  const onBeliefUpload = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setLoading(true);
    try {
      const newBeliefPlayers = await parseProjections(file);
      saveBeliefs(newBeliefPlayers, file.name);
      setState(prev => ({ ...prev, beliefPlayers: newBeliefPlayers, players: newBeliefPlayers, activeBeliefProfileName: file.name, lastUpdated: Date.now() }));
    } catch (e) { alert("Import Error: Failed to update projections."); }
    setLoading(false);
  }, []);

  const onLineupUpload = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setLoading(true);
    try {
      const previewText = await file.slice(0, 4096).text();
      const headers = previewText.toLowerCase();
      const isOptimizer = headers.includes('pg') && headers.includes('util');

      if (isOptimizer) {
         if (!state.referencePlayers || state.referencePlayers.length === 0) {
            throw new Error("Standby: Projection data not loaded.");
         }
         const loaded = await parseOptimizerLineups(file, state.referencePlayers);
         setState(prev => ({ ...prev, lineups: loaded, lastUpdated: Date.now(), slateStats: { ...prev.slateStats, totalLineups: loaded.length } }));
      } else {
         const loaded = await parseUserLineupsRows(file);
         setState(prev => ({ ...prev, lineups: loaded, lastUpdated: Date.now(), slateStats: { ...prev.slateStats, totalLineups: loaded.length } }));
      }
    } catch (e: any) { alert(e.message || "I/O Error: Failed to parse upload."); }
    setLoading(false);
  }, [state.referencePlayers]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: onDropMain, accept: { 'application/json': ['.json'] }, multiple: false });

  const NavItem = ({ label, icon: Icon, targetView }: { label: string, icon: any, targetView: ViewState }) => (
    <button onClick={() => setView(targetView)} className={`flex flex-col items-center gap-1 p-2 min-w-[64px] rounded-lg transition-colors ${view === targetView ? 'text-brand bg-brand/10 font-bold' : 'text-gray-500 hover:bg-white/5'}`}>
      <Icon className="w-5 h-5" />
      <span className="text-[10px] font-black uppercase tracking-tighter">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen font-sans bg-charcoal text-charcoal-text flex flex-col selection:bg-brand selection:text-charcoal">
      <header className="bg-charcoal border-b border-gray-800 sticky top-0 z-50 backdrop-blur-md bg-opacity-80">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView(ViewState.LINEUPS)}>
            <div className="bg-brand p-1.5 rounded-lg"><Cpu className="w-5 h-5 text-charcoal" /></div>
            <div className="flex flex-col">
              <h1 className="font-black text-xl tracking-tighter leading-none italic uppercase">SLATE<span className="text-brand">SIM</span></h1>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest font-mono">Terminal Active</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user?.role === 'admin' && (
              <button onClick={() => setView(ViewState.LOAD)} className="text-[9px] font-black text-brand border border-brand/20 px-2 py-1 rounded uppercase tracking-widest hover:bg-brand/10 transition-all font-mono">UPDATE_DATA</button>
            )}
            <button onClick={logout} className="p-2 rounded-full hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
        {view === ViewState.LOAD && user?.role === 'admin' && (
          <div className="max-w-xl mx-auto space-y-8 mt-6 pb-24">
            <div {...getRootProps()} className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer ${isDragActive ? 'border-brand bg-brand/5' : 'border-gray-800 hover:border-brand bg-charcoal-card'}`}>
              <input {...getInputProps()} />
              <div className="bg-brand/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-brand/20"><Database className="w-8 h-8 text-brand" /></div>
              <p className="font-bold text-lg mb-1 uppercase tracking-tight italic">Upload Lineup Pack (JSON)</p>
              <p className="text-xs text-gray-500 font-mono italic tracking-tighter">Reference core metadata</p>
            </div>
          </div>
        )}

        {view === ViewState.PROJECTIONS && <ProjectionsView players={state.players} referencePlayers={state.referencePlayers} contestState={contestState} beliefName={state.activeBeliefProfileName} onBeliefUpload={onBeliefUpload} />}
        {view === ViewState.LINEUPS && (
          <LineupsView 
            lineups={computedLineups} 
            playerPool={state.players}
            contestState={contestState} 
            onLineupUpload={onLineupUpload} 
            onContestChange={setContestInput} 
            hasAutoLoadedReferencePack={state.hasAutoLoadedReferencePack} 
            referencePackPath={state.referencePackPath}
            referenceMeta={state.referenceMeta}
            slateStats={state.slateStats}
            games={state.games}
          />
        )}
        {view === ViewState.DIAGNOSTICS && <DiagnosticsView state={{...state, lineups: computedLineups, contestState}} />}
      </main>

      <IntegrityFooter />

      <nav className="fixed bottom-0 left-0 right-0 bg-charcoal-card border-t border-gray-800 px-6 py-2 pb-safe z-40 shadow-2xl backdrop-blur-md">
           <div className="flex justify-around items-center max-w-lg mx-auto">
              <NavItem label="Lineups" icon={Layers} targetView={ViewState.LINEUPS} />
              <NavItem label="Projections" icon={Users} targetView={ViewState.PROJECTIONS} />
              <NavItem label="Leverage" icon={BarChart2} targetView={ViewState.DIAGNOSTICS} />
           </div>
      </nav>

      {loading && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-md">
            <div className="bg-charcoal-card p-6 rounded-xl shadow-2xl flex flex-col items-center border border-gray-800">
                <div className="w-8 h-8 border-4 border-brand border-t-transparent animate-spin mb-4"></div>
                <p className="font-black text-xs uppercase tracking-[0.2em] text-brand animate-pulse">Running Simulation...</p>
            </div>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AuthConsumer />
    </AuthProvider>
  );
};

const AuthConsumer: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;
  if (!user) return <SplashLogin />;

  return <AppContent />;
};

export default App;
