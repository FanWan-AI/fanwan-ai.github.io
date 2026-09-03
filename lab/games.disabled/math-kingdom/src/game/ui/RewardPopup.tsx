import React from 'react';
import { motion } from 'framer-motion';
import { Star, Coins, RefreshCw, ArrowRight } from 'lucide-react';

interface RewardPopupProps {
  visible: boolean;
  coins: number;
  stars: number;
  onNext: () => void;
  onRetry?: () => void;
  isWin: boolean;
}

export const RewardPopup: React.FC<RewardPopupProps> = ({ visible, coins, stars, onNext, onRetry, isWin }) => {
  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="card"
        style={{
          padding: '2rem',
          textAlign: 'center',
          minWidth: '300px',
          background: isWin ? '#FFF9C4' : '#FFEBEE'
        }}
      >
        <h2 style={{ fontSize: '2rem', color: isWin ? '#FBC02D' : '#E57373' }}>
          {isWin ? '太棒了！' : '加油！'}
        </h2>
        
        {isWin && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', margin: '2rem 0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Coins size={48} color="#FFD700" fill="#FFD700" />
              <span style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '0.5rem' }}>+{coins}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Star size={48} color="#FFC107" fill="#FFC107" />
              <span style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '0.5rem' }}>+{stars}</span>
            </div>
          </div>
        )}

        {!isWin && (
          <p style={{ fontSize: '1.2rem', color: '#666' }}>再试一次，你一定行！</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
          {onRetry && (
            <button className="btn-secondary" onClick={onRetry} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <RefreshCw size={20} /> 再试一次
            </button>
          )}
          <button className="btn-primary" onClick={onNext} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {isWin ? '下一关' : '继续'} <ArrowRight size={20} />
          </button>
        </div>
      </motion.div>
    </div>
  );
};
