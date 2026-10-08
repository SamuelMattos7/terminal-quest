import { Navigate, Route, Routes } from 'react-router-dom';
import { strings } from '../strings.js';
import { Landing } from '../pages/Landing.js';
import { PlaceholderPage } from '../pages/PlaceholderPage.js';
import { WorldMap } from '../pages/WorldMap.js';

/**
 * Full route table (plan.md §9.2). Pages owned by T4.2/T4.3 render an
 * explicit placeholder until their milestone — see PROGRESS.md Known gaps.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/map" element={<WorldMap />} />
      <Route
        path="/play/:levelId"
        element={<PlaceholderPage title={strings.levelPageTitle} taskId="T4.2" />}
      />
      <Route
        path="/spellbook"
        element={<PlaceholderPage title={strings.navSpellbook} taskId="T4.3" />}
      />
      <Route path="/skills" element={<PlaceholderPage title={strings.navSkills} taskId="T4.3" />} />
      <Route
        path="/profile"
        element={<PlaceholderPage title={strings.navProfile} taskId="T4.3" />}
      />
      <Route
        path="/settings"
        element={<PlaceholderPage title={strings.navSettings} taskId="T4.3" />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
