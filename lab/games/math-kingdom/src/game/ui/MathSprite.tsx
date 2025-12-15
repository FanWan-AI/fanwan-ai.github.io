import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface MathSpriteProps {
  message?: string;
  emotion?: 'happy' | 'thinking' | 'celebrate';
  onClick?: () => void;
}

export const MathSprite: React.FC<MathSpriteProps> = ({ message, emotion = 'happy', onClick }) => {
  const [visibleMessage, setVisibleMessage] = useState(message);

  useEffect(() => {
    if (message) {
      setVisibleMessage(message);
      const timer = setTimeout(() => setVisibleMessage(undefined), 5000); // Auto hide after 5s
      return () => clearTimeout(timer);
    }
  }, [message]);

  return (
    <div style={{
      position: 'fixed',
      bottom: '2rem',
      left: '2rem',
      zIndex: 90,
      display: 'flex',
      alignItems: 'flex-end',
      gap: '1rem'
    }}>
      {/* Sprite Character */}
      <motion.div
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        animate={{ y: [0, -10, 0] }}
        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        onClick={onClick}
        style={{
          width: '80px',
          height: '80px',
          cursor: 'pointer',
          position: 'relative'
        }}
      >
        {/* Simple SVG Sprite */}
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <circle cx="50" cy="50" r="40" fill="#4CAF50" />
          <circle cx="35" cy="40" r="5" fill="white" />
          <circle cx="65" cy="40" r="5" fill="white" />
          {emotion === 'happy' && <path d="M 30 60 Q 50 75 70 60" stroke="white" strokeWidth="3" fill="none" />}
          {emotion === 'thinking' && <line x1="30" y1="60" x2="70" y2="60" stroke="white" strokeWidth="3" />}
          {emotion === 'celebrate' && <path d="M 30 60 Q 50 80 70 60" stroke="white" strokeWidth="3" fill="none" />}
          {/* Antenna */}
          <line x1="50" y1="10" x2="50" y2="0" stroke="#4CAF50" strokeWidth="4" />
          <circle cx="50" cy="0" r="5" fill="#FFC107" />
        </svg>
      </motion.div>

      {/* Speech Bubble */}
      <AnimatePresence>
        {visibleMessage && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, x: -20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="card"
            style={{
              maxWidth: '200px',
              padding: '1rem',
              background: 'white',
              borderRadius: '16px 16px 16px 0',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}
          >
            <p style={{ margin: 0, fontSize: '1rem' }}>{visibleMessage}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
