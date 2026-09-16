import { createRoot } from 'react-dom/client'
import './index.css'
import { registerServiceWorker } from './pwa'
import { Root } from './ui/Root'

if (import.meta.env.PROD) registerServiceWorker()

createRoot(document.getElementById('root')!).render(<Root />)
