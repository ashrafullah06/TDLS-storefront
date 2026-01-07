import React from 'react';

const LanguageToggle = ({ currentLang, setLang }) => {
  return (
    <div className="language-toggle">
      <button onClick={() => setLang('en')} disabled={currentLang === 'en'}>
        English
      </button>
      <button onClick={() => setLang('bn')} disabled={currentLang === 'bn'}>
        বাংলা
      </button>
    </div>
  );
};

export default LanguageToggle;