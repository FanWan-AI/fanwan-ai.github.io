import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Play, Settings, Trophy } from 'lucide-react';
import '../../styles/theme.css';

export const HomeHub: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="home-hub" style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #e0f7fa 0%, #e8f5e9 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background Elements */}
      <div style={{ position: 'absolute', top: '10%', left: '10%', opacity: 0.2 }}>
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="var(--color-primary)" />
        </svg>
      </div>
      <div style={{ position: 'absolute', bottom: '20%', right: '15%', opacity: 0.2 }}>
        <svg width="120" height="120" viewBox="0 0 100 100">
          <rect x="20" y="20" width="60" height="60" fill="var(--color-secondary)" transform="rotate(15 50 50)" />
        </svg>
      </div>

      <motion.h1 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        style={{ 
          fontSize: '4rem', 
          color: 'var(--color-primary-dark)',
          marginBottom: '2rem',
          textShadow: '2px 2px 0px white'
        }}
      >
        Math Kingdom
      </motion.h1>

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        style={{ display: 'flex', gap: '1rem', flexDirection: 'column' }}
      >
        <button 
          className="btn-primary" 
          style={{ fontSize: '2rem', padding: '1rem 4rem', display: 'flex', alignItems: 'center', gap: '1rem' }}
          onClick={() => navigate('/map')}
        >
          <Play size={32} /> 开始冒险
        </button>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button className="btn-secondary" style={{ padding: '0.8rem' }}>
            <Trophy size={24} />
          </button>
          <button className="btn-secondary" style={{ padding: '0.8rem' }}>
            <Settings size={24} />
          </button>
        </div>
      </motion.div>
    </div>
  );
};
