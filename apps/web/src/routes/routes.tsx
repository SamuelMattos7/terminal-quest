import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from '../pages/Landing.js';
import { LevelPage } from '../pages/LevelPage.js';
import { ProfilePage } from '../pages/ProfilePage.js';
import { SettingsPage } from '../pages/SettingsPage.js';
import { SkillsPage } from '../pages/SkillsPage.js';
import { SpellbookPage } from '../pages/SpellbookPage.js';
import { WorldMap } from '../pages/WorldMap.js';

/** Full route table (plan.md §9.2). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/map" element={<WorldMap />} />
      <Route path="/play/:levelId" element={<LevelPage />} />
      <Route path="/spellbook" element={<SpellbookPage />} />
      <Route path="/skills" element={<SkillsPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
