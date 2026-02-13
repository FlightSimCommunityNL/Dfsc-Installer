import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import { App } from './ui/App'
import { Splash } from './ui/Splash'

const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
const isSplash = params.get('splash') === '1'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isSplash ? <Splash /> : <App />}
  </React.StrictMode>
)
