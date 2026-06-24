// public/theme.js
(function() {
  const currentTheme = localStorage.getItem('clinicq_theme') || 'light';
  if (currentTheme === 'dark') {
    document.documentElement.classList.add('dark-mode');
  }

  window.toggleTheme = function() {
    const isDark = document.documentElement.classList.toggle('dark-mode');
    localStorage.setItem('clinicq_theme', isDark ? 'dark' : 'light');
    updateThemeIcon();
  };

  function updateThemeIcon() {
    const isDark = document.documentElement.classList.contains('dark-mode');
    const toggleBtns = document.querySelectorAll('.theme-toggle-btn');
    toggleBtns.forEach(btn => {
      btn.innerHTML = isDark ? '🌙' : '☀️';
      btn.title = isDark ? "Switch to Light Mode" : "Switch to Dark Mode";
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateThemeIcon();
    // Attach click listeners to any toggle buttons
    const toggleBtns = document.querySelectorAll('.theme-toggle-btn');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        window.toggleTheme();
      });
    });
  });
})();
