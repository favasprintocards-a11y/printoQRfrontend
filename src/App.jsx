import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import { saveAs } from 'file-saver';
import QRCode from 'qrcode';
import logo from './assets/logo.png';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function App() {
  const [step, setStep] = useState(0); // 0: Upload, 1: Config, 2: Success
  const [file, setFile] = useState(null);
  const [stats, setStats] = useState(null);
  const [config, setConfig] = useState({
    width: 300,
    margin: 4,
    errorCorrectionLevel: 'H', // Default to high if we use logos
    colIndex: 0,
    format: 'png',
    colorDark: '#000000',
    colorLight: '#ffffff',
    moduleStyle: 'square', // square, dots, rounded
    eyeStyle: 'square', // square, rounded
    logoSize: 20
  });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [previews, setPreviews] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Analyze file when dropped
  const onDrop = useCallback(async (acceptedFiles) => {
    const uploadedFile = acceptedFiles[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', uploadedFile);

    try {
      const res = await axios.post(`${API_URL}/analyze`, formData);
      setStats(res.data);
      setStep(1);
    } catch (err) {
      console.error(err);
      setError('Failed to parse file. Please ensure it is a valid Excel file.');
    } finally {
      setLoading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls']
    },
    multiple: false
  });

  // Generate local previews when stats or config changes
  useEffect(() => {
    if (!stats || !stats.preview) return;

    const generatePreviews = async () => {
      const newPreviews = [];
      const items = stats.preview.slice(0, 6);

      for (const row of items) {
        if (!row) continue;
        const val = row[config.colIndex];
        if (!val) continue;

        const text = String(val);
        // We use a simple backend call for the first item to show "True" preview, 
        // OR we just show colors for now. 
        // Since user wants to SEE the style, we MUST render it.
        // Let's implement a simple SVG renderer here similar to backend.

        try {
          const qr = QRCode.create(text, { errorCorrectionLevel: config.errorCorrectionLevel });
          const modules = qr.modules;
          const size = modules.size;
          // We just render as Data URI SVG
          let shapes = '';

          for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
              if (modules.get(r, c)) {
                // Logic similar to backend
                const isFinder = (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);
                // Apply Styles
                const modStyle = isFinder && config.eyeStyle === 'square' ? 'square' : config.moduleStyle;

                // Color
                const fill = config.colorDark;

                if (modStyle === 'dots') {
                  shapes += `<circle cx="${c + 0.5}" cy="${r + 0.5}" r="0.4" fill="${fill}" />`;
                } else if (modStyle === 'rounded') {
                  shapes += `<rect x="${c + 0.1}" y="${r + 0.1}" width="0.8" height="0.8" rx="0.2" fill="${fill}" />`;
                } else {
                  shapes += `<rect x="${c}" y="${r}" width="1" height="1" fill="${fill}" />`;
                }
              }
            }
          }

          const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="150" height="150"><rect width="100%" height="100%" fill="${config.colorLight}"/>${shapes}</svg>`;
          const blob = new Blob([svg], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);

          newPreviews.push({ val, url });
        } catch (e) {
          console.error(e);
        }
      }
      setPreviews(newPreviews);
    };

    generatePreviews();
  }, [stats, config]);

  const handleGenerate = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('width', config.width);
    formData.append('margin', config.margin);
    formData.append('errorCorrectionLevel', config.errorCorrectionLevel);
    formData.append('colIndex', config.colIndex);
    formData.append('format', config.format);
    formData.append('colorDark', config.colorDark);
    formData.append('colorLight', config.colorLight);
    formData.append('moduleStyle', config.moduleStyle);
    formData.append('eyeStyle', config.eyeStyle);
    formData.append('logoSize', config.logoSize);
    if (logoFile) {
      formData.append('logo', logoFile);
    }

    try {
      const response = await axios.post(`${API_URL}/generate`, formData, {
        responseType: 'blob'
      });

      const blob = new Blob([response.data], { type: 'application/zip' });
      saveAs(blob, `qrcodes_${Date.now()}.zip`);

      const successCount = response.headers['x-success-count'];
      const skippedCount = response.headers['x-skipped-count'];

      setStats(prev => ({ ...prev, successCount, skippedCount }));
      setStep(2);
    } catch (err) {
      console.error(err);
      setError('Error generating QR codes. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep(0);
    setFile(null);
    setStats(null);
    setPreviews([]);
    setError(null);
  };

  return (
    <div className="app-container">
      <div className="logo-wrapper">
        <img src={logo} alt="Printo Logo" className="main-logo" />
      </div>
      <h1>QR Generator</h1>

      {step === 0 && (
        <div className="upload-section">
          <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
            <input {...getInputProps()} />
            <div className="icon-upload">📂</div>
            {loading ? (
              <p>Analyzing file...</p>
            ) : (
              <p>Drag & drop your Excel file here, or click to select</p>
            )}
          </div>
          {error && <div className="error-msg">{error}</div>}
        </div>
      )}

      {step === 1 && stats && (
        <div className="config-layout animation-fade">
          <div className="config-main">
            {/* 1. Data Source Card */}
            <div className="config-section-card">
              <div className="config-section-title">📊 Data Source</div>
              <div className="config-grid">
                <div className="form-group">
                  <label>Excel Column</label>
                  <select
                    value={config.colIndex}
                    onChange={(e) => setConfig({ ...config, colIndex: Number(e.target.value) })}
                  >
                    {stats.headers && stats.headers.map((h, i) => (
                      <option key={i} value={i}>
                        Row {i + 1}: {h || 'Empty'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Error Correction</label>
                  <select
                    value={config.errorCorrectionLevel}
                    onChange={(e) => setConfig({ ...config, errorCorrectionLevel: e.target.value })}
                  >
                    <option value="L">Low (7%)</option>
                    <option value="M">Medium (15%)</option>
                    <option value="Q">Quartile (25%)</option>
                    <option value="H">High (30%) - Best for logos</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 2. Design Style Card */}
            <div className="config-section-card">
              <div className="config-section-title">🎨 Design & Colors</div>
              <div className="config-grid">
                <div className="form-group">
                  <label>Module Pattern</label>
                  <select
                    value={config.moduleStyle}
                    onChange={(e) => setConfig({ ...config, moduleStyle: e.target.value })}
                  >
                    <option value="square">Square</option>
                    <option value="rounded">Rounded Modules</option>
                    <option value="dots">Dots</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Eye Style (Corners)</label>
                  <select
                    value={config.eyeStyle}
                    onChange={(e) => setConfig({ ...config, eyeStyle: e.target.value })}
                  >
                    <option value="square">Square</option>
                    <option value="rounded">Rounded</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Foreground Color</label>
                  <input
                    type="color"
                    value={config.colorDark}
                    onChange={(e) => setConfig({ ...config, colorDark: e.target.value })}
                    style={{ width: '100%', height: '40px', padding: '0', cursor: 'pointer' }}
                  />
                </div>
                <div className="form-group">
                  <label>Background Color</label>
                  <input
                    type="color"
                    value={config.colorLight}
                    onChange={(e) => setConfig({ ...config, colorLight: e.target.value })}
                    style={{ width: '100%', height: '40px', padding: '0', cursor: 'pointer' }}
                  />
                </div>
              </div>
            </div>

            {/* 3. Logo Options Card */}
            <div className="config-section-card">
              <div className="config-section-title">🖼️ Logo Integration</div>
              <div className="config-grid">
                <div className="form-group">
                  <label>Upload Center Logo</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files[0];
                      if (f) {
                        setLogoFile(f);
                        setLogoPreview(URL.createObjectURL(f));
                      }
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>Logo Size (% of QR)</label>
                  <input
                    type="range"
                    min="10"
                    max="30"
                    value={config.logoSize}
                    onChange={(e) => setConfig({ ...config, logoSize: Number(e.target.value) })}
                  />
                  <div style={{ fontSize: '12px', textAlign: 'right' }}>{config.logoSize}%</div>
                </div>
              </div>
              {logoPreview && (
                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <img src={logoPreview} alt="Logo Preview" style={{ width: '40px', height: '40px', borderRadius: '4px', border: '1px solid var(--primary)' }} />
                  <button
                    onClick={() => { setLogoFile(null); setLogoPreview(null); }}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}
                  >
                    Remove Logo
                  </button>
                </div>
              )}
            </div>

            {/* 4. Export Settings Card */}
            <div className="config-section-card">
              <div className="config-section-title">💾 Output Format</div>
              <div className="config-grid">
                <div className="form-group">
                  <label>File Format</label>
                  <select
                    value={config.format}
                    onChange={(e) => setConfig({ ...config, format: e.target.value })}
                  >
                    <option value="png">PNG (Recommended)</option>
                    <option value="jpeg">JPEG</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Resolution (px)</label>
                  <select
                    value={config.width}
                    onChange={(e) => setConfig({ ...config, width: Number(e.target.value) })}
                  >
                    <option value={300}>300x300 (Standard)</option>
                    <option value={600}>600x600 (High Res)</option>
                    <option value={1200}>1200x1200 (Print Ready)</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button className="btn" style={{ backgroundColor: '#e2e8f0', color: '#4a5568', flex: 1 }} onClick={handleReset}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleGenerate} disabled={loading}>
                {loading ? <><div className="spinner"></div> Processing...</> : 'Generate Bulk ZIP'}
              </button>
            </div>
          </div>

          {/* Right Column: Previews & Status */}
          <div className="config-sidebar" style={{ position: 'sticky', top: '2rem' }}>
            <div className="stats-card" style={{ marginBottom: '1.5rem' }}>
              <div className="stat-item">
                <span className="stat-value">{stats.totalRows}</span>
                <span className="stat-label">Records</span>
              </div>
            </div>

            <h3 style={{ marginBottom: '1rem', fontSize: '14px', color: 'var(--text-light)' }}>
              LIVE PREVIEW (Sample)
            </h3>
            <div className="preview-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {previews.slice(0, 2).map((p, i) => (
                <div key={i} className="preview-card" style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img src={p.url} alt="Preview" style={{ width: '180px', height: '180px' }} />
                    {logoPreview && (
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: `${config.logoSize}%`,
                        height: `${config.logoSize}%`,
                        background: 'white',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '2px'
                      }}>
                        <img src={logoPreview} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: '#1a202c', marginTop: '10px', wordBreak: 'break-all' }}>
                    {p.val}
                  </div>
                </div>
              ))}
              {stats.totalRows > 2 && (
                <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-light)' }}>
                  + {stats.totalRows - 2} more will be generated
                </div>
              )}
            </div>
          </div>
        </div>
      )
      }

      {
        step === 2 && (
          <div className="success-section animation-fade" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>✅</div>
            <h2>Processing Complete!</h2>
            <div className="stats-card" style={{ marginTop: '2rem' }}>
              <div className="stat-item">
                <span className="stat-value" style={{ color: 'var(--success)' }}>{stats?.successCount || 0}</span>
                <span className="stat-label">Generated</span>
              </div>
              <div className="stat-item">
                <span className="stat-value" style={{ color: 'var(--error)' }}>{stats?.skippedCount || 0}</span>
                <span className="stat-label">Skipped</span>
              </div>
            </div>
            <p style={{ marginBottom: '2rem', color: 'var(--text-light)' }}>
              Your ZIP file download should have started automatically.
            </p>
            <button className="btn btn-primary" onClick={handleReset}>
              Process Another File
            </button>
          </div>
        )
      }
    </div >
  );
}

export default App;
