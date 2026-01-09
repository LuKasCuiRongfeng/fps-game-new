import React from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage, type SupportedLanguage } from '../../i18n';

export const LanguageToggle: React.FC = () => {
    const { i18n, t } = useTranslation();
    const current = (i18n.language === 'en' ? 'en' : 'zh') as SupportedLanguage;

    const Button = ({ lang }: { lang: SupportedLanguage }) => {
        const active = current === lang;
        return (
            <button
                className={
                    'px-2 py-1 rounded-md text-xs border transition-colors pointer-events-auto ' +
                    (active
                        ? 'bg-white/15 border-white/25 text-white'
                        : 'bg-black/20 border-white/10 text-white/70 hover:text-white hover:border-white/20')
                }
                onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setLanguage(lang);
                }}
                type="button"
            >
                {t(`language.${lang}`)}
            </button>
        );
    };

    return (
        <div className="flex items-center gap-2 select-none">
            <Button lang="zh" />
            <Button lang="en" />
        </div>
    );
};
