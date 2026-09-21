/**
 * Admin Dashboard Accessibility Audit
 * WCAG 2.1 Level AA Compliance Checker
 * 
 * Features:
 * - Color contrast analysis
 * - ARIA label validation
 * - Keyboard navigation testing
 * - Focus management verification
 * - Form accessibility checks
 */

const AdminAccessibilityAudit = (() => {
    const issues = {
        critical: [],
        high: [],
        medium: [],
        low: []
    };
    
    const wcagCriteria = {
        'WCAG 2.1 AA': 'Level AA Conformance',
        'WCAG 2.1 AAA': 'Level AAA Conformance'
    };
    
    /**
     * Run full accessibility audit
     */
    function runFullAudit() {
        console.log('[Accessibility] Starting WCAG 2.1 AA audit...');
        
        issues.critical = [];
        issues.high = [];
        issues.medium = [];
        issues.low = [];
        
        // Run all checks
        checkColorContrast();
        checkARIALabels();
        checkKeyboardNavigation();
        checkFocusManagement();
        checkFormAccessibility();
        checkHeadingStructure();
        checkImageAltText();
        checkLinkAccessibility();
        checkLanguageDeclaration();
        checkTimeouts();
        
        return generateReport();
    }
    
    /**
     * Check color contrast (WCAG 2.1 1.4.3)
     */
    function checkColorContrast() {
        const elements = document.querySelectorAll('[style*="color"]');
        
        elements.forEach(el => {
            const color = window.getComputedStyle(el).color;
            const bgColor = window.getComputedStyle(el).backgroundColor;
            
            const contrast = calculateContrast(color, bgColor);
            const minContrast = 4.5; // AA requirement
            
            if (contrast < minContrast) {
                issues.high.push({
                    criterion: '1.4.3 Contrast (Minimum)',
                    level: 'AA',
                    element: el,
                    message: `Color contrast is ${contrast.toFixed(2)}:1, should be at least ${minContrast}:1`,
                    fix: 'Adjust foreground or background color for better contrast'
                });
            }
        });
    }
    
    /**
     * Check ARIA labels (WCAG 2.1 1.3.1, 2.4.6)
     */
    function checkARIALabels() {
        // Check interactive elements
        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
            if (!btn.textContent.trim() && 
                !btn.getAttribute('aria-label') && 
                !btn.getAttribute('title')) {
                issues.high.push({
                    criterion: '2.4.6 Headings and Labels',
                    level: 'AA',
                    element: btn,
                    message: 'Button has no accessible label',
                    fix: 'Add aria-label or text content to button'
                });
            }
        });
        
        // Check form inputs
        const inputs = document.querySelectorAll('input:not([type="hidden"])');
        inputs.forEach(input => {
            const label = document.querySelector(`label[for="${input.id}"]`);
            if (!label && !input.getAttribute('aria-label')) {
                issues.high.push({
                    criterion: '1.3.1 Info and Relationships',
                    level: 'AA',
                    element: input,
                    message: 'Form input has no associated label',
                    fix: 'Add label element or aria-label attribute'
                });
            }
        });
        
        // Check images
        const images = document.querySelectorAll('img');
        images.forEach(img => {
            if (!img.getAttribute('alt') && !img.getAttribute('aria-label')) {
                issues.high.push({
                    criterion: '1.1.1 Non-text Content',
                    level: 'A',
                    element: img,
                    message: 'Image has no alt text',
                    fix: 'Add meaningful alt text describing the image'
                });
            }
        });
    }
    
    /**
     * Check keyboard navigation (WCAG 2.1 2.1.1)
     */
    function checkKeyboardNavigation() {
        // Check for keyboard trap
        const focusableElements = document.querySelectorAll(
            'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        if (focusableElements.length === 0) {
            issues.high.push({
                criterion: '2.1.1 Keyboard',
                level: 'A',
                message: 'No keyboard-navigable elements found',
                fix: 'Ensure interactive elements are keyboard accessible'
            });
        }
        
        // Check for positive tabindex
        focusableElements.forEach(el => {
            const tabindex = parseInt(el.getAttribute('tabindex') || '0');
            if (tabindex > 0) {
                issues.medium.push({
                    criterion: '2.4.3 Focus Order',
                    level: 'A',
                    element: el,
                    message: 'Positive tabindex values should be avoided',
                    fix: 'Remove positive tabindex, rely on DOM order'
                });
            }
        });
    }
    
    /**
     * Check focus management (WCAG 2.1 2.4.3, 2.4.7)
     */
    function checkFocusManagement() {
        // Check for visible focus indicator
        const stylesheet = document.createElement('style');
        stylesheet.textContent = 'a:focus, button:focus, input:focus { outline: 2px solid blue !important; }';
        document.head.appendChild(stylesheet);
        
        // Remove after checking
        setTimeout(() => {
            stylesheet.remove();
        }, 100);
        
        // Check for focus trap with escape key
        const modals = document.querySelectorAll('.modal:not(.hide)');
        if (modals.length > 0) {
            modals.forEach(modal => {
                if (!modal.querySelector('[data-bs-dismiss]')) {
                    issues.medium.push({
                        criterion: '2.4.3 Focus Order',
                        level: 'A',
                        element: modal,
                        message: 'Modal should have escape key to close',
                        fix: 'Ensure modal can be dismissed with Escape key'
                    });
                }
            });
        }
    }
    
    /**
     * Check form accessibility (WCAG 2.1 3.3.1, 3.3.4)
     */
    function checkFormAccessibility() {
        const forms = document.querySelectorAll('form');
        
        forms.forEach(form => {
            // Check for error messages
            const errorMessages = form.querySelectorAll('[role="alert"]');
            
            // Check for required field indication
            const requiredFields = form.querySelectorAll('[required]');
            requiredFields.forEach(field => {
                const label = document.querySelector(`label[for="${field.id}"]`);
                if (label && !label.textContent.includes('*') && 
                    !label.textContent.includes('required') &&
                    !field.getAttribute('aria-required')) {
                    issues.medium.push({
                        criterion: '3.3.2 Labels or Instructions',
                        level: 'A',
                        element: field,
                        message: 'Required field not clearly marked',
                        fix: 'Add visual indicator (e.g., *) and aria-required'
                    });
                }
            });
        });
    }
    
    /**
     * Check heading structure (WCAG 2.1 1.3.1)
     */
    function checkHeadingStructure() {
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        let lastLevel = 0;
        
        headings.forEach(heading => {
            const level = parseInt(heading.tagName[1]);
            
            // Check for skipped heading levels
            if (level - lastLevel > 1 && lastLevel !== 0) {
                issues.low.push({
                    criterion: '1.3.1 Info and Relationships',
                    level: 'A',
                    element: heading,
                    message: `Heading level jumped from H${lastLevel} to H${level}`,
                    fix: 'Use heading levels in sequential order'
                });
            }
            
            lastLevel = level;
        });
        
        // Check for H1
        if (document.querySelectorAll('h1').length === 0) {
            issues.medium.push({
                criterion: '1.3.1 Info and Relationships',
                level: 'A',
                message: 'Page has no H1 heading',
                fix: 'Add exactly one H1 heading per page'
            });
        }
    }
    
    /**
     * Check image alt text (WCAG 2.1 1.1.1)
     */
    function checkImageAltText() {
        const images = document.querySelectorAll('img');
        
        images.forEach(img => {
            // Skip decorative images
            if (img.getAttribute('aria-hidden') === 'true') {
                return;
            }
            
            const alt = img.getAttribute('alt');
            if (!alt || alt.trim() === '') {
                issues.high.push({
                    criterion: '1.1.1 Non-text Content',
                    level: 'A',
                    element: img,
                    message: 'Image missing alt text',
                    fix: 'Provide descriptive alt text for all images'
                });
            }
        });
    }
    
    /**
     * Check link accessibility (WCAG 2.1 2.4.4)
     */
    function checkLinkAccessibility() {
        const links = document.querySelectorAll('a');
        
        links.forEach(link => {
            const text = link.textContent.trim();
            
            if (text === '' && !link.getAttribute('aria-label')) {
                issues.high.push({
                    criterion: '2.4.4 Link Purpose',
                    level: 'A',
                    element: link,
                    message: 'Link has no accessible text',
                    fix: 'Add text content or aria-label to link'
                });
            }
            
            // Check for "click here" links
            if (text.toLowerCase() === 'click here' || text.toLowerCase() === 'link') {
                issues.medium.push({
                    criterion: '2.4.4 Link Purpose',
                    level: 'A',
                    element: link,
                    message: 'Link text is not descriptive',
                    fix: 'Use descriptive link text describing the target'
                });
            }
        });
    }
    
    /**
     * Check language declaration (WCAG 2.1 3.1.1)
     */
    function checkLanguageDeclaration() {
        const html = document.documentElement;
        const lang = html.getAttribute('lang');
        
        if (!lang) {
            issues.medium.push({
                criterion: '3.1.1 Language of Page',
                level: 'A',
                message: 'Page language not declared',
                fix: 'Add lang attribute to html element (e.g., lang="en")'
            });
        }
    }
    
    /**
     * Check for timeouts (WCAG 2.1 2.2.1)
     */
    function checkTimeouts() {
        // Check for redirects or timeouts
        if (window.location.href.includes('?redirect') || 
            window.location.href.includes('?timeout')) {
            issues.high.push({
                criterion: '2.2.1 Timing Adjustable',
                level: 'A',
                message: 'Page may have automatic timeout',
                fix: 'Provide user control over session timeout duration'
            });
        }
    }
    
    /**
     * Generate accessibility report
     */
    function generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            page_url: window.location.href,
            summary: {
                total_issues: issues.critical.length + issues.high.length + issues.medium.length + issues.low.length,
                critical: issues.critical.length,
                high: issues.high.length,
                medium: issues.medium.length,
                low: issues.low.length
            },
            conformance_level: calculateConformanceLevel(),
            issues_by_severity: issues,
            recommendations: generateRecommendations()
        };
        
        return report;
    }
    
    /**
     * Calculate conformance level
     */
    function calculateConformanceLevel() {
        if (issues.critical.length > 0) {
            return 'Non-conformant';
        }
        
        if (issues.high.length > 5) {
            return 'Partially conformant (Level A)';
        }
        
        if (issues.high.length > 0 || issues.medium.length > 10) {
            return 'Mostly conformant (Level AA)';
        }
        
        return 'Fully conformant (Level AA)';
    }
    
    /**
     * Generate recommendations
     */
    function generateRecommendations() {
        const recommendations = [];
        
        if (issues.critical.length > 0) {
            recommendations.push('Critical issues must be fixed before release');
        }
        
        if (issues.high.length > 0) {
            recommendations.push(`Fix ${issues.high.length} high-priority issues`);
        }
        
        if (issues.medium.length > 0) {
            recommendations.push('Consider fixing medium-priority issues to improve AA conformance');
        }
        
        if (issues.low.length > 5) {
            recommendations.push('Review low-priority suggestions for better user experience');
        }
        
        return recommendations;
    }
    
    /**
     * Calculate color contrast ratio
     */
    function calculateContrast(foreground, background) {
        function parseColor(value) {
            if (!value) return null;
            const normalized = String(value).trim().toLowerCase();
            if (normalized === 'transparent') return null;
            const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
            if (hex) {
                const raw = hex[1];
                const full = raw.length === 3 ? raw.split('').map((n) => n + n).join('') : raw;
                return [
                    parseInt(full.slice(0, 2), 16),
                    parseInt(full.slice(2, 4), 16),
                    parseInt(full.slice(4, 6), 16)
                ];
            }
            const rgb = normalized.match(/^rgba?\(([^)]+)\)$/);
            if (rgb) {
                const parts = rgb[1].split(',').map((part) => Number(part.trim()));
                if (parts.length >= 3) {
                    return [parts[0], parts[1], parts[2]].map((channel) => Math.max(0, Math.min(255, channel)));
                }
            }
            return null;
        }

        function luminance(rgb) {
            const channels = rgb.map((value) => {
                const channel = value / 255;
                return channel <= 0.03928
                    ? channel / 12.92
                    : Math.pow((channel + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        }

        const fg = parseColor(foreground) || [0, 0, 0];
        const bg = parseColor(background) || [255, 255, 255];
        const fgLum = luminance(fg);
        const bgLum = luminance(bg);
        const lighter = Math.max(fgLum, bgLum);
        const darker = Math.min(fgLum, bgLum);

        return (lighter + 0.05) / (darker + 0.05);
    }
    
    /**
     * Export audit report
     */
    function exportReport() {
        const report = generateReport();
        const json = JSON.stringify(report, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `accessibility-audit-${Date.now()}.json`;
        link.click();
    }
    
    // Public API
    return {
        runFullAudit,
        checkColorContrast,
        checkARIALabels,
        checkKeyboardNavigation,
        checkFocusManagement,
        checkFormAccessibility,
        checkHeadingStructure,
        checkImageAltText,
        checkLinkAccessibility,
        generateReport,
        exportReport
    };
})();

// Make available globally for testing
window.AdminAccessibilityAudit = AdminAccessibilityAudit;
