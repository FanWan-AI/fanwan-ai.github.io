import { createBrowserRouter } from 'react-router-dom';
import { HomeHub } from '../game/scenes/HomeHub';
import { IslandSelect } from '../game/scenes/IslandSelect';
import { Grade1Forest } from '../game/scenes/Grade1Forest';
import { FruitSort } from '../game/minigames/FruitSort/FruitSort';
import { BridgeBuild } from '../game/minigames/BridgeBuild/BridgeBuild';
import { ShapeHouse } from '../game/minigames/ShapeHouse/ShapeHouse';
import { SeasonSort } from '../game/minigames/SeasonSort/SeasonSort';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <HomeHub />,
  },
  {
    path: '/map',
    element: <IslandSelect />,
  },
  {
    path: '/map/grade1',
    element: <Grade1Forest />,
  },
  {
    path: '/game/grade1/fruit-sort',
    element: <FruitSort />,
  },
  {
    path: '/game/grade1/bridge-build',
    element: <BridgeBuild />,
  },
  {
    path: '/game/grade1/shape-house',
    element: <ShapeHouse />,
  },
  {
    path: '/game/grade1/season-sort',
    element: <SeasonSort />,
  },
]);
