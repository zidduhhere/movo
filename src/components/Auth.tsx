import { useState } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, User, Mail, Lock, EyeOff, Eye } from 'lucide-react';

export function Auth() {
    const { login, register, isLoading, error } = useStore();
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password || (!isLogin && !name)) return;
        
        try {
            if (isLogin) {
                await login(email, password);
            } else {
                await register(email, name, password);
            }
        } catch (e) {
            console.error("Auth error", e);
        }
    };

    return (
        <div className="flex-1 h-screen w-screen flex flex-col items-center justify-center bg-[#FAFAFA]">
            <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="w-full max-w-[420px]"
            >
                {/* White Card */}
                <div className="bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[24px] p-10">
                    <div className="text-center mb-8">
                        <h1 className="text-[28px] font-bold text-[#2D2D2D]">
                            {isLogin ? "Welcome Back!" : "Create Account"}
                        </h1>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                        <AnimatePresence mode="wait">
                            {!isLogin && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                                    animate={{ opacity: 1, height: 'auto', marginTop: 0 }}
                                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                                    className="overflow-hidden"
                                >
                                    <label className="block text-[13px] font-semibold text-[#2D2D2D] mb-2">
                                        Full Name <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative flex items-center bg-white border border-[#E5E5E5] rounded-[8px] focus-within:border-[#85D24E] transition-colors">
                                        <div className="pl-3 pr-2 text-[#8E8E93]">
                                            <User className="w-5 h-5" strokeWidth={1.5} />
                                        </div>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="John Wick"
                                            className="flex-1 bg-transparent py-3 pr-4 text-[14px] text-[#2D2D2D] placeholder-[#A0A0A0] outline-none"
                                            required={!isLogin}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div>
                            <label className="block text-[13px] font-semibold text-[#2D2D2D] mb-2">
                                Email <span className="text-red-500">*</span>
                            </label>
                            <div className="relative flex items-center bg-white border border-[#E5E5E5] rounded-[8px] focus-within:border-[#85D24E] transition-colors">
                                <div className="pl-3 pr-2 text-[#8E8E93]">
                                    <Mail className="w-5 h-5" strokeWidth={1.5} />
                                </div>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="john.wick@gmail.com"
                                    className="flex-1 bg-transparent py-3 pr-4 text-[14px] text-[#2D2D2D] placeholder-[#A0A0A0] outline-none"
                                    required
                                    disabled={isLoading}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[13px] font-semibold text-[#2D2D2D] mb-2">
                                Password <span className="text-red-500">*</span>
                            </label>
                            <div className="relative flex items-center bg-white border border-[#E5E5E5] rounded-[8px] focus-within:border-[#85D24E] transition-colors">
                                <div className="pl-3 pr-2 text-[#8E8E93]">
                                    <Lock className="w-5 h-5" strokeWidth={1.5} />
                                </div>
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••••••"
                                    className="flex-1 bg-transparent py-3 pr-2 text-[14px] text-[#2D2D2D] placeholder-[#A0A0A0] outline-none tracking-widest"
                                    required
                                    disabled={isLoading}
                                />
                                <div 
                                    className="pr-3 pl-2 text-[#8E8E93] cursor-pointer hover:text-[#2D2D2D] transition-colors"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? (
                                        <Eye className="w-5 h-5" strokeWidth={1.5} />
                                    ) : (
                                        <EyeOff className="w-5 h-5" strokeWidth={1.5} />
                                    )}
                                </div>
                            </div>
                            
                            {isLogin && (
                                <div className="mt-2 text-right">
                                    <a href="#" className="text-[12px] font-medium text-[#85D24E] hover:underline underline-offset-2">
                                        Forgot Password
                                    </a>
                                </div>
                            )}
                        </div>

                        {error && (
                            <motion.p 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="text-[13px] text-[#FF3B30] text-center mt-2"
                            >
                                {error}
                            </motion.p>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="mt-6 w-full flex items-center justify-center gap-2 bg-[#85D24E] hover:bg-[#78C245] text-[#1C1C1E] py-3.5 rounded-[12px] text-[15px] font-medium transition-all active:scale-[0.98] disabled:opacity-70"
                        >
                            {isLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                isLogin ? "Login" : "Sign Up"
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <button
                            onClick={() => {
                                setIsLogin(!isLogin);
                                useStore.setState({ error: null });
                            }}
                            className="text-[13px] text-[#8E8E93] hover:text-[#1C1C1E] transition-colors focus:outline-none font-medium"
                        >
                            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Login"}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
