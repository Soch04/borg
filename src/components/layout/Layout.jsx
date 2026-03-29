import Dock from './Dock'
import Header from './Header'
import ToastContainer from '../ui/ToastContainer'
import './Layout.css'

export default function Layout({ children }) {
  return (
    <div className="layout">
      <Header />
      {/* layout-body is the push container: dock + main are flex siblings */}
      <div className="layout-body">
        <Dock />
        <main className="layout-main">
          {children}
        </main>
      </div>
      <ToastContainer />
    </div>
  )
}
