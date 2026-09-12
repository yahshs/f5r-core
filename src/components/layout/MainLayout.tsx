import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import Navbar from './Navbar';
import Footer from './Footer';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
  children: ReactNode;
  showFooter?: boolean;
  className?: string;
}

export default function MainLayout({ children, showFooter = true, className }: MainLayoutProps) {
  return (
    <div className={cn('flex min-h-screen flex-col', className)}>
      <Navbar />
      <motion.main
        className="flex-1"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {children}
      </motion.main>
      {showFooter && <Footer />}
    </div>
  );
}
