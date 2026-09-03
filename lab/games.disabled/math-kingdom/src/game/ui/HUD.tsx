import React from 'react';
import { Star, Coins, Zap } from 'lucide-react';
import { useGameStore } from '../../core/store';
import { motion } from 'framer-motion';

export const HUD: React.FC = () => {
  const { coins, stars, energy, maxEnergy, level } = useGameStore();

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      padding: '1rem',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      pointerEvents: 'none', // Allow clicking through
      zIndex: 100
    }}>
      {/* Left: Level & Energy */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div className="card" style={{ 
          padding: '0.5rem 1rem', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.5rem',
          pointerEvents: 'auto',
          background: 'rgba(255, 255, 255, 0.9)'
        }}>
          <div style={{ 
            width: '32px', 
            height: '32px', 
            borderRadius: '50%', 
            background: 'var(--color-primary)', 
            color: 'white',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            fontWeight: 'bold'
          }}>
            {level}
          </div>
          <div style={{ width: '100px', height: '12px', background: '#eee', borderRadius: '6px', overflow: 'hidden' }}>
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${(energy / maxEnergy) * 100}%` }}
              style={{ height: '100%', background: 'linear-gradient(90deg, #FFC107, #FF9800)' }}
            />
          </div>
          <Zap size={20} color="#FF9800" fill="#FF9800" />
        </div>
      </div>

      {/* Right: Currency */}
      <div style={{ display: 'flex', gap: '1rem' }}>
        <div className="card" style={{ 
          padding: '0.5rem 1rem', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.5rem',
          pointerEvents: 'auto',
          background: 'rgba(255, 255, 255, 0.9)'
        }}>
          <Coins size={24} color="#FFD700" fill="#FFD700" />
          <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>{coins}</span>
        </div>
        
        <div className="card" style={{ 
          padding: '0.5rem 1rem', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.5rem',
          pointerEvents: 'auto',
          background: 'rgba(255, 255, 255, 0.9)'
        }}>
          <Star size={24} color="#FFC107" fill="#FFC107" />
          <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>{stars}</span>
        </div>
      </div>
    </div>
  );
};
