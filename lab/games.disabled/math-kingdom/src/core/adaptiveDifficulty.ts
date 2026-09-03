export interface DifficultyState {
  currentDifficulty: number; // 1-5
  consecutiveCorrect: number;
  consecutiveWrong: number;
  history: { result: 'correct' | 'wrong', time: number }[];
}

export const initialDifficultyState: DifficultyState = {
  currentDifficulty: 1,
  consecutiveCorrect: 0,
  consecutiveWrong: 0,
  history: []
};

export const updateDifficulty = (
  state: DifficultyState, 
  isCorrect: boolean, 
  timeTaken: number
): DifficultyState => {
  const newState = { ...state };
  
  // Update history (keep last 10)
  newState.history = [...newState.history, { result: (isCorrect ? 'correct' : 'wrong') as 'correct' | 'wrong', time: timeTaken }].slice(-10);

  if (isCorrect) {
    newState.consecutiveCorrect++;
    newState.consecutiveWrong = 0;

    // Increase difficulty if 3 consecutive correct answers
    if (newState.consecutiveCorrect >= 3 && newState.currentDifficulty < 5) {
      newState.currentDifficulty++;
      newState.consecutiveCorrect = 0; // Reset counter after level up
    }
  } else {
    newState.consecutiveWrong++;
    newState.consecutiveCorrect = 0;

    // Decrease difficulty if 2 consecutive wrong answers
    if (newState.consecutiveWrong >= 2 && newState.currentDifficulty > 1) {
      newState.currentDifficulty--;
      newState.consecutiveWrong = 0; // Reset counter after level down
    }
  }

  return newState;
};

export const getHintType = (state: DifficultyState): 'none' | 'simple' | 'strong' => {
  if (state.consecutiveWrong === 1) return 'simple';
  if (state.consecutiveWrong >= 2) return 'strong';
  return 'none';
};
