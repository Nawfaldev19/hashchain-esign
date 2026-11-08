import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { Button } from './ui';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button variant="quiet" iconOnly onClick={toggle} aria-label={`Switch to ${next} theme`}>
      {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
