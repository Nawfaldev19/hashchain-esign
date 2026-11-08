import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Context as GraphQLClientContext } from 'urql';
import { App } from './App';
import { ToastHost } from './components/overlays';
import { createClient } from './graphql/client';

const container = document.getElementById('root');
if (!container) throw new Error('The page is missing its #root element.');

createRoot(container).render(
  <StrictMode>
    <GraphQLClientContext value={createClient()}>
      <BrowserRouter>
        <ToastHost>
          <App />
        </ToastHost>
      </BrowserRouter>
    </GraphQLClientContext>
  </StrictMode>,
);
