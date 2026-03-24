const fs = require('fs');

try {
// 1. Update index.html
let html = fs.readFileSync('indotrade/frontend/index.html', 'utf8');

const oldNavRegex = /<nav class="nav-menu">[\s\S]*?<\/nav>/;
const newNav = `<nav class="nav-menu">
                <a href="#dashboard" class="nav-item active" data-tab="dashboard">
                    <span class="nav-icon">📊</span>
                    <span class="nav-text">Dashboard</span>
                </a>
                <a href="#watchlist" class="nav-item" data-tab="watchlist">
                    <span class="nav-icon">📋</span>
                    <span class="nav-text">Watchlist</span>
                </a>
                <a href="#equity" class="nav-item" data-tab="equity">
                    <span class="nav-icon">📈</span>
                    <span class="nav-text">Equity (NSE/BSE)</span>
                </a>
                <a href="#fo" class="nav-item" data-tab="fo">
                    <span class="nav-icon">⚡</span>
                    <span class="nav-text">F&O Options</span>
                </a>
                <a href="#crypto" class="nav-item" data-tab="crypto">
                    <span class="nav-icon">🪙</span>
                    <span class="nav-text">Crypto</span>
                </a>
                <a href="#mf" class="nav-item" data-tab="mf">
                    <span class="nav-icon">🏦</span>
                    <span class="nav-text">Mutual Funds</span>
                </a>
                <a href="#ipo" class="nav-item" data-tab="ipo">
                    <span class="nav-icon">🚀</span>
                    <span class="nav-text">IPOs</span>
                </a>
                <a href="#risk" class="nav-item" data-tab="risk">
                    <span class="nav-icon">🛡️</span>
                    <span class="nav-text">Risk Engine</span>
                </a>
            </nav>`;
html = html.replace(oldNavRegex, newNav);
fs.writeFileSync('indotrade/frontend/index.html', html);
console.log('index.html updated successfully.');


// 2. Update style.css
let css = fs.readFileSync('indotrade/frontend/css/style.css', 'utf8');

const newNavMenuCss = `.nav-menu {
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
  gap: 8px;
}`;
css = css.replace(/\.nav-menu\s*\{[\s\S]*?\}/, newNavMenuCss);

const newNavItemCss = `.nav-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  color: var(--text2);
  text-decoration: none;
  border-radius: var(--r);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 600;
  font-family: var(--font-head);
  letter-spacing: 0.3px;
  border: 1px solid transparent;
}

.nav-icon {
  margin-right: 12px;
  font-size: 1.1rem;
  opacity: 0.8;
  transition: transform 0.3s ease;
}

.nav-item:hover {
  color: var(--text);
  background-color: rgba(255, 255, 255, 0.03);
}

.nav-item:hover .nav-icon {
  transform: scale(1.1);
  opacity: 1;
}

.nav-item\.active {
  color: #fff;
  background-color: var(--accent);
  box-shadow: 0 4px 12px rgba(124, 106, 247, 0.3);
}

.nav-item\.active .nav-icon {
  opacity: 1;
}`;
css = css.replace(/\.nav-item\s*\{[\s\S]*?\.nav-item\.active\s*\{[\s\S]*?\}/, newNavItemCss);


const newTabPaneCss = `.tab-pane {
  display: none;
  padding: 24px;
  animation: fadeInSlideUp 0.4s ease-out forwards;
}`;
css = css.replace(/\.tab-pane\s*\{[\s\S]*?\}/, newTabPaneCss);

if (!css.includes('@keyframes fadeInSlideUp')) {
    css += `\n@keyframes fadeInSlideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}\n`;
}

fs.writeFileSync('indotrade/frontend/css/style.css', css);
console.log('style.css updated successfully.');


// 3. Update app.js
let js = fs.readFileSync('indotrade/frontend/js/app.js', 'utf8');

// Replace tab target fetch
js = js.replace(/const targetId = tab\.getAttribute\('data-tab'\);/, `const targetItem = e.target.closest('.nav-item') || tab;
      const targetId = targetItem.getAttribute('data-tab');`);

// Replace active class toggles on tab
js = js.replace(/tabs\.forEach\(t => t\.classList\.remove\('active'\)\);\s*tab\.classList\.add\('active'\);/, `tabs.forEach(t => t.classList.remove('active'));
      targetItem.classList.add('active');`);

// Replace tab pane logic
js = js.replace(/const targetPane = document\.getElementById\(\`tab-\$\{targetId\}\`\);\s*if \(targetPane\) targetPane\.classList\.add\('active'\);/, `const targetPane = document.getElementById(\`tab-\${targetId}\`);
      if (targetPane) {
        targetPane.classList.remove('active');
        void targetPane.offsetWidth;
        targetPane.classList.add('active');
      }`);

fs.writeFileSync('indotrade/frontend/js/app.js', js);
console.log('app.js updated successfully.');

} catch (err) {
  console.error("Error updating files:", err);
}
