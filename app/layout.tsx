import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Star Class · Ngajar Afi',description:'Setiap kontribusi berarti. Papan apresiasi interaktif untuk kelas Pemol.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="id"><body>{children}</body></html>}
