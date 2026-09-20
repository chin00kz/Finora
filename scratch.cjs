const fs = require('fs');
let modal = fs.readFileSync('src/components/CustomizeNavModal.tsx', 'utf8');
const iconImport = "import { Home, PieChart, List, Users, BarChart3, Target, Repeat, MoreHorizontal, Settings as SettingsIcon, FileText, X, ArrowUp, ArrowDown } from 'lucide-react';";
modal = modal.replace(/import \{[\s\S]*?\} from 'lucide-react';/, iconImport);
fs.writeFileSync('src/components/CustomizeNavModal.tsx', modal, 'utf8');
console.log('done');
