import Dock from './Dock'
import Header from './Header'
import ToastContainer from '../ui/ToastContainer'
import './Layout.css'

export default function Layout({ children }) {
  return (
    <div className="layout">
      <Header />
      <Dock />
      <main className="layout-main">
        {children}
      </main>
      <ToastContainer />
    </div>
  )
}
