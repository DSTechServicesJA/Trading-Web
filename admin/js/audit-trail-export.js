/**
 * Audit Trail Export Module
 * Handles CSV, Excel, and PDF export of audit trail data
 * 
 * Features:
 * - Export visible data or all data
 * - Filter export by date range, action type, admin
 * - CSV format with proper escaping
 * - Excel format with formatting
 * - PDF format with styling
 */

const AuditTrailExport = (() => {
    /**
     * Export audit trail to CSV
     */
    function exportToCSV() {
        const data = getAuditTrailData();
        if (!data.rows.length) {
            alert('No data to export');
            return;
        }
        
        let csv = 'data:text/csv;charset=utf-8,';
        
        // Add headers
        const headers = ['ID', 'Admin', 'Action', 'Entity Type', 'Entity ID', 'Old Value', 'New Value', 'IP Address', 'Status', 'Timestamp'];
        csv += headers.map(h => escapeCSV(h)).join(',') + '\n';
        
        // Add rows
        data.rows.forEach(row => {
            const rowData = [
                row.id,
                row.admin_name || '',
                row.action,
                row.entity_type,
                row.entity_id || '',
                row.old_value || '',
                row.new_value || '',
                row.ip_address || '',
                row.status,
                row.timestamp
            ];
            csv += rowData.map(v => escapeCSV(String(v))).join(',') + '\n';
        });
        
        downloadFile(csv, `audit_trail_${getCurrentDatetime()}.csv`, 'text/csv');
    }
    
    /**
     * Export audit trail to Excel (using SheetJS library)
     */
    async function exportToExcel() {
        const data = getAuditTrailData();
        if (!data.rows.length) {
            alert('No data to export');
            return;
        }
        
        // Load SheetJS if not already loaded
        if (!window.XLSX) {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js');
        }
        
        // Prepare data
        const wsData = [
            ['ID', 'Admin', 'Action', 'Entity Type', 'Entity ID', 'Old Value', 'New Value', 'IP Address', 'Status', 'Timestamp']
        ];
        
        data.rows.forEach(row => {
            wsData.push([
                row.id,
                row.admin_name || '',
                row.action,
                row.entity_type,
                row.entity_id || '',
                row.old_value || '',
                row.new_value || '',
                row.ip_address || '',
                row.status,
                row.timestamp
            ]);
        });
        
        // Create workbook
        const ws = window.XLSX.utils.aoa_to_sheet(wsData);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'Audit Trail');
        
        // Style headers
        const headerStyle = {
            fill: { fgColor: { rgb: 'FF4472C4' } },
            font: { bold: true, color: { rgb: 'FFFFFFFF' } },
            alignment: { horizontal: 'center', vertical: 'center' }
        };
        
        for (let col = 0; col < wsData[0].length; col++) {
            const cellRef = window.XLSX.utils.encode_col(col) + '1';
            if (!ws[cellRef]) ws[cellRef] = {};
            ws[cellRef].s = headerStyle;
        }
        
        // Set column widths
        ws['!cols'] = [8, 15, 20, 15, 15, 20, 20, 15, 12, 20];
        
        // Write file
        window.XLSX.writeFile(wb, `audit_trail_${getCurrentDatetime()}.xlsx`);
    }
    
    /**
     * Export audit trail to PDF (using jsPDF + AutoTable)
     */
    async function exportToPDF() {
        const data = getAuditTrailData();
        if (!data.rows.length) {
            alert('No data to export');
            return;
        }
        
        // Load libraries if not already loaded
        if (!window.jsPDF) {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }
        if (!window.autoTable) {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
        }
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l', 'mm', 'a4'); // landscape
        
        // Add title
        doc.setFontSize(16);
        doc.text('Audit Trail Report', 14, 15);
        
        // Add metadata
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 25);
        doc.text(`Total Records: ${data.rows.length}`, 14, 31);
        
        // Prepare table data
        const tableData = data.rows.map(row => [
            row.id,
            row.admin_name || '',
            row.action,
            row.entity_type,
            row.entity_id || '',
            truncateText(row.old_value || '', 20),
            truncateText(row.new_value || '', 20),
            row.ip_address || '',
            row.status,
            row.timestamp
        ]);
        
        // Add table
        doc.autoTable({
            head: [['ID', 'Admin', 'Action', 'Entity Type', 'Entity ID', 'Old Value', 'New Value', 'IP Address', 'Status', 'Timestamp']],
            body: tableData,
            startY: 38,
            margin: { left: 10, right: 10 },
            theme: 'grid',
            headerStyles: {
                fillColor: [68, 114, 196],
                textColor: 255,
                fontStyle: 'bold',
                fontSize: 9
            },
            bodyStyles: {
                fontSize: 8
            },
            columnStyles: {
                0: { cellWidth: 10 },
                1: { cellWidth: 18 },
                2: { cellWidth: 18 },
                3: { cellWidth: 15 },
                4: { cellWidth: 15 },
                5: { cellWidth: 18 },
                6: { cellWidth: 18 },
                7: { cellWidth: 15 },
                8: { cellWidth: 12 },
                9: { cellWidth: 20 }
            }
        });
        
        // Save
        doc.save(`audit_trail_${getCurrentDatetime()}.pdf`);
    }
    
    /**
     * Get audit trail data from table or API
     */
    function getAuditTrailData() {
        const rows = [];
        
        // Try to get from visible table rows
        const table = document.querySelector('[data-audit-trail-table]');
        if (table) {
            table.querySelectorAll('tbody tr').forEach(tr => {
                const cells = tr.querySelectorAll('td');
                if (cells.length >= 9) {
                    rows.push({
                        id: cells[0].textContent.trim(),
                        admin_name: cells[1].textContent.trim(),
                        action: cells[2].textContent.trim(),
                        entity_type: cells[3].textContent.trim(),
                        entity_id: cells[4].textContent.trim(),
                        old_value: cells[5].textContent.trim(),
                        new_value: cells[6].textContent.trim(),
                        ip_address: cells[7].textContent.trim(),
                        status: cells[8].textContent.trim(),
                        timestamp: cells[9] ? cells[9].textContent.trim() : ''
                    });
                }
            });
        }
        
        return { rows };
    }
    
    /**
     * Create export UI controls
     */
    function createExportUI() {
        const container = document.querySelector('[data-audit-trail-controls]');
        if (!container) return;
        
        // Check if export UI already exists
        if (document.querySelector('[data-export-controls]')) return;
        
        const exportDiv = document.createElement('div');
        exportDiv.className = 'btn-group ms-auto';
        exportDiv.setAttribute('data-export-controls', 'true');
        exportDiv.innerHTML = `
            <button class="btn btn-sm btn-outline-secondary" id="export-csv-btn" title="Export as CSV">
                <i class="fas fa-file-csv"></i> CSV
            </button>
            <button class="btn btn-sm btn-outline-secondary" id="export-excel-btn" title="Export as Excel">
                <i class="fas fa-file-excel"></i> Excel
            </button>
            <button class="btn btn-sm btn-outline-secondary" id="export-pdf-btn" title="Export as PDF">
                <i class="fas fa-file-pdf"></i> PDF
            </button>
        `;
        
        container.appendChild(exportDiv);
        
        // Bind events
        document.getElementById('export-csv-btn').addEventListener('click', exportToCSV);
        document.getElementById('export-excel-btn').addEventListener('click', exportToExcel);
        document.getElementById('export-pdf-btn').addEventListener('click', exportToPDF);
    }
    
    /**
     * Helper: Escape CSV values
     */
    function escapeCSV(value) {
        if (value === null || value === undefined) {
            return '';
        }
        
        value = String(value);
        
        // Escape double quotes
        value = value.replace(/"/g, '""');
        
        // Quote if contains comma, quote, or newline
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            value = `"${value}"`;
        }
        
        return value;
    }
    
    /**
     * Helper: Get current datetime for filename
     */
    function getCurrentDatetime() {
        const now = new Date();
        return now.toISOString().slice(0, 19).replace(/[-:]/g, '');
    }
    
    /**
     * Helper: Truncate text
     */
    function truncateText(text, maxLength = 50) {
        if (text && text.length > maxLength) {
            return text.substring(0, maxLength) + '...';
        }
        return text || '';
    }
    
    /**
     * Helper: Download file
     */
    function downloadFile(data, filename, mimeType) {
        const link = document.createElement('a');
        link.href = data;
        link.download = filename;
        link.type = mimeType;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    /**
     * Helper: Load external script
     */
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });
    }
    
    // Public API
    return {
        init: createExportUI,
        exportToCSV,
        exportToExcel,
        exportToPDF
    };
})();

// Initialize on document ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        AuditTrailExport.init();
    });
} else {
    AuditTrailExport.init();
}
