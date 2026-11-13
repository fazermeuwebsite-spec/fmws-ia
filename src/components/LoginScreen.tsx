import React, { useState } from 'react';
import { Lock, Mail, User as UserIcon, ShieldCheck, AlertCircle, ArrowRight, Eye, EyeOff, Database } from 'lucide-react';
import { api } from '../services/api';
import { signInFirebaseWithGoogle } from '../firebase';
import { User } from '../types';

interface LoginScreenProps {
  needsAdminSetup: boolean;
  sessionNotice?: string | null;
  onAuthenticated: (user: User, permissions: string[]) => void;
  onRequireSessionRefresh?: () => Promise<void>;
}

const AuthShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-[#090B10] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
    <div className="absolute -top-32 -left-32 w-96 h-96 bg-[#D4A72C]/10 rounded-full blur-3xl pointer-events-none" />
    <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-[#D4A72C]/5 rounded-full blur-3xl pointer-events-none" />

    <div className="w-full max-w-md bg-[#11141E] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden relative z-10">
      <div className="p-6 border-b border-slate-800/80 bg-[#0d1017] flex items-center gap-3.5">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#D4A72C] via-[#B88E1E] to-[#7A5B0B] p-[1.5px] shadow-lg shadow-[#D4A72C]/15 flex items-center justify-center shrink-0">
          <div className="w-full h-full bg-[#090B10] rounded-[10px] flex items-center justify-center">
            <span className="font-extrabold text-[#D4A72C] text-sm tracking-tighter">FMWS</span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-black text-white text-lg tracking-wide">FMWS</h1>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#D4A72C]/20 text-[#D4A72C] border border-[#D4A72C]/40">
              SALES AI
            </span>
          </div>
          <p className="text-xs text-slate-400">Fazer Meu Website • Acesso Restrito</p>
        </div>
      </div>

      {children}
    </div>
  </div>
);

/**
 * FLUXO 1: CONFIGURAÇÃO INICIAL (Exibido somente quando não há administrador no banco)
 */
const InitialAdminSetupView: React.FC<{
  onAuthenticated: (user: User, permissions: string[]) => void;
  onRequireSessionRefresh?: () => Promise<void>;
}> = ({ onAuthenticated, onRequireSessionRefresh }) => {
  const [name, setName] = useState('Nicolas Admin');
  const [email, setEmail] = useState('admin@fazermeuwebsite.com.br');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSetup = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const fbUser = await signInFirebaseWithGoogle();
      const idToken = await fbUser.getIdToken();
      const res = await api.setupAdminWithGoogle(idToken);
      onAuthenticated(res.user, res.permissions);
    } catch (err: any) {
      if (err?.code === 'ADMIN_ALREADY_EXISTS' && onRequireSessionRefresh) {
        await onRequireSessionRefresh();
      }
      setError(err?.message || 'Falha ao configurar administrador com Google.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Informe o nome do administrador.');
      return;
    }
    if (!email.includes('@')) {
      setError('Informe um endereço de e-mail válido.');
      return;
    }
    if (password.length < 6) {
      setError('A senha do administrador deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas digitadas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.setupAdmin({ name: name.trim(), email: email.trim(), password });
      onAuthenticated(res.user, res.permissions);
    } catch (err: any) {
      if (err?.code === 'ADMIN_ALREADY_EXISTS' && onRequireSessionRefresh) {
        await onRequireSessionRefresh();
      }
      setError(err.message || 'Falha ao configurar o administrador.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={handleSetupSubmit} className="p-6 space-y-4">
        <div className="p-3.5 rounded-xl bg-[#D4A72C]/10 border border-[#D4A72C]/30 text-xs text-amber-200 space-y-1">
          <div className="font-bold text-[#D4A72C] flex items-center gap-1.5">
            <ShieldCheck size={15} />
            <span>Configuração Inicial: Cadastrar Administrador</span>
          </div>
          <p className="text-slate-300 text-[11px] leading-relaxed">
            Nenhum administrador configurado ainda no banco persistente. Este cadastro ocorre uma única vez.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Nome do Administrador</label>
          <div className="relative">
            <UserIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">E-mail Corporativo</label>
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@fazermeuwebsite.com.br"
              required
              autoComplete="email"
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Definir Senha (mín. 6 caracteres)
          </label>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg pl-9 pr-9 py-2.5 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Confirmar Senha</label>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || googleLoading}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 transition-all shadow-lg shadow-[#D4A72C]/15 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
        >
          <span>{loading ? 'Registrando administrador...' : 'Salvar Administrador e Acessar Painel'}</span>
          <ArrowRight size={15} />
        </button>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-800" />
          <span className="shrink mx-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            ou entrar direto com Google
          </span>
          <div className="flex-grow border-t border-slate-800" />
        </div>

        <button
          type="button"
          onClick={handleGoogleSetup}
          disabled={loading || googleLoading}
          className="w-full py-2.5 px-4 rounded-xl bg-[#090B10] hover:bg-slate-900 border border-slate-700 hover:border-[#D4A72C]/60 text-slate-200 font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
        >
          <Database size={14} className="text-[#D4A72C]" />
          <span>
            {googleLoading
              ? 'Autenticando com Google...'
              : 'Configurar Admin e Entrar com Google (Firestore)'}
          </span>
        </button>

        <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 text-center">
          Firestore já conectado • Senha protegida com hash bcrypt e sessão assinada no servidor.
        </div>
      </form>
    </AuthShell>
  );
};

/**
 * FLUXO 2: LOGIN CORPORATIVO (Exibido exclusivamente sempre que já existir administrador)
 */
const CorporateLoginView: React.FC<{
  sessionNotice?: string | null;
  onAuthenticated: (user: User, permissions: string[]) => void;
  onRequireSessionRefresh?: () => Promise<void>;
}> = ({ sessionNotice, onAuthenticated, onRequireSessionRefresh }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(email.trim(), password);
      onAuthenticated(res.user, res.permissions);
    } catch (err: any) {
      if (err?.code === 'NEEDS_ADMIN_SETUP' && onRequireSessionRefresh) {
        await onRequireSessionRefresh();
      }
      setError(err.message || 'E-mail ou senha inválidos.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const fbUser = await signInFirebaseWithGoogle();
      const idToken = await fbUser.getIdToken();
      const res = await api.loginWithGoogle(idToken);
      onAuthenticated(res.user, res.permissions);
    } catch (err: any) {
      if (err?.code === 'NEEDS_ADMIN_SETUP' && onRequireSessionRefresh) {
        await onRequireSessionRefresh();
      }
      setError(err?.message || 'Não foi possível entrar com sua conta Google.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={handleLoginSubmit} className="p-6 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-white">Autenticação Corporativa</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Entre com seu e-mail e senha autorizados ou com sua conta Google vinculada ao Firestore.
          </p>
        </div>

        {sessionNotice && !error && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0 text-[#D4A72C]" />
            <span>{sessionNotice}</span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">E-mail Corporativo</label>
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seuemail@fazermeuwebsite.com.br"
              required
              autoComplete="email"
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Senha</label>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg pl-9 pr-9 py-2.5 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || googleLoading}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 transition-all shadow-lg shadow-[#D4A72C]/15 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
        >
          <span>{loading ? 'Validando acesso...' : 'Entrar no Sistema'}</span>
          <ArrowRight size={15} />
        </button>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-800" />
          <span className="shrink mx-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            ou acesso conectado ao Firestore
          </span>
          <div className="flex-grow border-t border-slate-800" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading || googleLoading}
          className={`w-full py-2.5 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 ${
            error && error.includes('Entrar com Google')
              ? 'bg-[#D4A72C]/15 hover:bg-[#D4A72C]/25 border-2 border-[#D4A72C] text-[#D4A72C] font-bold shadow-lg shadow-[#D4A72C]/15'
              : 'bg-[#090B10] hover:bg-slate-900 border border-slate-700 hover:border-[#D4A72C]/60 text-slate-200 font-semibold'
          }`}
        >
          <Database size={14} className="text-[#D4A72C]" />
          <span>{googleLoading ? 'Conectando Google & Firestore...' : 'Entrar com Google (Firestore Sync)'}</span>
        </button>

        <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 text-center">
          Autenticação protegida por sessão assinada (HttpOnly), Firestore conectado e RBAC no servidor.
        </div>
      </form>
    </AuthShell>
  );
};

export const LoginScreen: React.FC<LoginScreenProps> = ({
  needsAdminSetup,
  sessionNotice,
  onAuthenticated,
  onRequireSessionRefresh
}) => {
  if (needsAdminSetup) {
    return (
      <InitialAdminSetupView
        onAuthenticated={onAuthenticated}
        onRequireSessionRefresh={onRequireSessionRefresh}
      />
    );
  }
  return (
    <CorporateLoginView
      sessionNotice={sessionNotice}
      onAuthenticated={onAuthenticated}
      onRequireSessionRefresh={onRequireSessionRefresh}
    />
  );
};
