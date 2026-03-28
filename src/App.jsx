import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import { saveAs } from 'file-saver';
import QRCode from 'qrcode';
import logo from './assets/logo.png';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');

function App() {
  const [step, setStep] = useState(0); // 0: Upload, 1: Config, 2: Success
  const [file, setFile] = useState(null);
  const [stats, setStats] = useState(null);
  const [config, setConfig] = useState({
    width: 300,
    margin: 4,
    errorCorrectionLevel: 'H',
    colIndex: 0,
    format: 'png',
    colorDark: '#000000',
    colorLight: '#ffffff',
    moduleStyle: 'square',
    eyeStyle: 'square',
    logoSize: 20,
    showText: true,
    textFontSize: 16, // Matching server default better
    textAlign: 'center',
    textSpace: 0
  });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [previews, setPreviews] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [analysisTime, setAnalysisTime] = useState(0);
  const [progress, setProgress] = useState(0);

  // Analyze file when dropped
  const onDrop = useCallback(async (acceptedFiles) => {
    const uploadedFile = acceptedFiles[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setLoading(true);
    setError(null);
    setTimer(0);

    // Initial analysis timer
    const analyzeStart = Date.now();
    const analyzeInterval = setInterval(() => {
      setTimer(Math.floor((Date.now() - analyzeStart) / 1000));
    }, 1000);

    const formData = new FormData();
    formData.append('file', uploadedFile);

    try {
      const res = await axios.post(`${API_URL}/analyze`, formData);
      setAnalysisTime(res.data.analysisTime || Math.floor((Date.now() - analyzeStart) / 1000));
      setStats(res.data);
      setStep(1);
    } catch (err) {
      console.error(err);
      setError('Failed to parse file. Please ensure it is a valid Excel file.');
    } finally {
      setLoading(false);
      clearInterval(analyzeInterval);
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

  // Generate local previews when stats or relevant config changes
  useEffect(() => {
    if (!stats || !stats.preview) return;

    let active = true;
    const currentPreviews = [];

    const generatePreviews = async () => {
      const newPreviews = [];
      const items = stats.preview.slice(0, 6);

      for (const row of items) {
        if (!active) break;
        if (!row) continue;
        const val = row[config.colIndex];
        if (!val) continue;

        const text = String(val);
        try {
          const qr = QRCode.create(text, { errorCorrectionLevel: config.errorCorrectionLevel });
          const { modules } = qr;
          const size = modules.size;
          const margin = Number(config.margin);
          const totalSize = size + (2 * margin);
          
          let shapes = '';
          const fill = config.colorDark;
          const isFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);

          const eyes = [{ r: 0, c: 0 }, { r: 0, c: size - 7 }, { r: size - 7, c: 0 }];
          for (const eye of eyes) {
            const rect = (r, c, w, h, rx, f) => `<rect x="${c+margin}" y="${r+margin}" width="${w}" height="${h}" ${rx ? `rx="${rx}"` : ''} fill="${f}" />`;
            if (config.eyeStyle === 'rounded') {
              shapes += rect(eye.r, eye.c, 7, 7, 1.5, fill) + rect(eye.r + 1, eye.c + 1, 5, 5, config.colorLight) + rect(eye.r + 2, eye.c + 2, 3, 3, 0.5, fill);
            } else {
              shapes += rect(eye.r, eye.c, 7, 7, 0, fill) + rect(eye.r + 1, eye.c + 1, 5, 5, 0, config.colorLight) + rect(eye.r + 2, eye.c + 2, 3, 3, 0, fill);
            }
          }

          for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
              if (isFinder(r, c)) continue;
              if (modules.get(r, c)) {
                if (config.moduleStyle === 'dots') shapes += `<circle cx="${c + margin + 0.5}" cy="${r + margin + 0.5}" r="0.4" fill="${fill}" />`;
                else if (config.moduleStyle === 'rounded') shapes += `<rect x="${c + margin + 0.1}" y="${r + margin + 0.1}" width="0.8" height="0.8" rx="0.2" fill="${fill}" />`;
                else shapes += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="${fill}" />`;
              }
            }
          }

          const qrWidth = config.width || 300;
          const fontSize = config.textFontSize || 16;
          const unitRatio = totalSize / qrWidth;
          const textHeight = Math.max(Math.floor(qrWidth * 0.15), Math.floor(fontSize * 2.5));
          const textSpaceInt = Number(config.textSpace || 0);
          const textSpaceUnits = textSpaceInt * unitRatio;
          const textHeightUnits = (textHeight * unitRatio) + textSpaceUnits;
          const totalHeightUnits = config.showText ? totalSize + textHeightUnits : totalSize;
          
          let extraElements = '';
          if (logoPreview) {
            const lSizeUnits = (config.logoSize / 100) * size;
            const lPos = margin + (size - lSizeUnits) / 2;
            extraElements += `<rect x="${lPos - 0.2}" y="${lPos - 0.2}" width="${lSizeUnits + 0.4}" height="${lSizeUnits + 0.4}" fill="${config.colorLight}" />`;
            extraElements += `<image x="${lPos}" y="${lPos}" width="${lSizeUnits}" height="${lSizeUnits}" href="${logoPreview}" />`;
          }

          if (config.showText) {
            const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const textYUnits = totalSize + textSpaceUnits + ((textHeightUnits - textSpaceUnits) / 2);
            const fontSizeUnits = fontSize * unitRatio;
            
            let textAnchor = "middle";
            let textX = totalSize / 2;
            if (config.textAlign === 'left') {
               textAnchor = "start";
               textX = margin;
            } else if (config.textAlign === 'right') {
               textAnchor = "end";
               textX = totalSize - margin;
            }
            
            extraElements += `<text x="${textX}" y="${textYUnits}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSizeUnits}" fill="${config.colorDark}" text-anchor="${textAnchor}" dominant-baseline="middle" font-weight="bold">${escaped}</text>`;
          }

          const previewWidth = 180;
          const previewHeight = config.showText ? previewWidth * (totalHeightUnits / totalSize) : previewWidth;

          const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalHeightUnits}" width="${previewWidth}" height="${previewHeight}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${config.colorLight}"/>${shapes}${extraElements}</svg>`;
          const blob = new Blob([svg], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          newPreviews.push({ val, url });
          currentPreviews.push(url);
        } catch (e) {
          console.error(e);
        }
      }
      if (active) setPreviews(newPreviews);
    };

    generatePreviews();
    return () => {
      active = false;
      currentPreviews.forEach(url => URL.revokeObjectURL(url));
    };
  }, [stats, config, logoPreview]);

  // Combined timer and progress logic
  useEffect(() => {
    let interval;
    if (loading) {
      const start = Date.now();
      interval = setInterval(() => {
        setTimer(Math.floor((Date.now() - start) / 1000));
        if (step === 1) {
          setCountdown(prev => Math.max(1, prev - 1));
          // Fake progress bar increments if not real
          setProgress(prev => Math.min(98, prev + (100 / Math.max(20, countdown))));
        }
      }, 1000);
    } else {
      clearInterval(interval);
      if (step === 2) setProgress(100);
    }
    return () => clearInterval(interval);
  }, [loading, step]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const handleGenerate = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setTimer(0);
    setProgress(0);

    // Estimate: ~100 records per second + 2s buffer (Improved from 40)
    const est = Math.ceil(stats.totalRows / 100) + 2;
    setCountdown(est);

    const startTime = Date.now();

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
    formData.append('showText', config.showText);
    formData.append('textFontSize', config.textFontSize);
    formData.append('textAlign', config.textAlign || 'center');
    formData.append('textSpace', config.textSpace || 0);
    if (logoFile) formData.append('logo', logoFile);

    try {
      const response = await axios.post(`${API_URL}/generate`, formData, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/zip' });
      saveAs(blob, `qrcodes_${Date.now()}.zip`);

      const successCount = response.headers['x-success-count'];
      const skippedCount = response.headers['x-skipped-count'];

      setTotalTime(Math.floor((Date.now() - startTime) / 1000));
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
    setTimer(0);
    setTotalTime(0);
    setProgress(0);
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
              <div style={{ padding: '1rem' }}>
                <p style={{ fontWeight: 'bold' }}>Analyzing file... {timer}s</p>
                <div className="progress-bar" style={{ maxWidth: '300px', margin: '1rem auto' }}>
                  <div className="progress-fill" style={{ width: '60%' }}></div>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-light)' }}>Reading rows and headers...</p>
              </div>
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
                  <select value={config.colIndex} onChange={(e) => setConfig({ ...config, colIndex: Number(e.target.value) })}>
                    {stats.headers && stats.headers.map((h, i) => (
                      <option key={i} value={i}>Col {i + 1}: {h || 'Empty'}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Error Correction</label>
                  <select value={config.errorCorrectionLevel} onChange={(e) => setConfig({ ...config, errorCorrectionLevel: e.target.value })}>
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
                  <select value={config.moduleStyle} onChange={(e) => setConfig({ ...config, moduleStyle: e.target.value })}>
                    <option value="square">Square</option>
                    <option value="rounded">Rounded Modules</option>
                    <option value="dots">Dots</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Eye Style (Corners)</label>
                  <select value={config.eyeStyle} onChange={(e) => setConfig({ ...config, eyeStyle: e.target.value })}>
                    <option value="square">Square</option>
                    <option value="rounded">Rounded</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Foreground Color</label>
                  <input type="color" value={config.colorDark} onChange={(e) => setConfig({ ...config, colorDark: e.target.value })} style={{ width: '100%', height: '40px', padding: '0', cursor: 'pointer' }} />
                </div>
                <div className="form-group">
                  <label>Background Color</label>
                  <input type="color" value={config.colorLight} onChange={(e) => setConfig({ ...config, colorLight: e.target.value })} style={{ width: '100%', height: '40px', padding: '0', cursor: 'pointer' }} />
                </div>
              </div>
            </div>

            {/* 3. Logo Options Card */}
            <div className="config-section-card">
              <div className="config-section-title">🖼️ Logo Integration</div>
              <div className="config-grid">
                <div className="form-group">
                  <label>Upload Center Logo</label>
                  <input type="file" accept="image/*" onChange={(e) => {
                    const f = e.target.files[0];
                    if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); }
                  }} />
                </div>
                <div className="form-group">
                  <label>Logo Size ({config.logoSize}% of QR)</label>
                  <input type="range" min="10" max="30" value={config.logoSize} onChange={(e) => setConfig({ ...config, logoSize: Number(e.target.value) })} />
                </div>
              </div>
              {logoPreview && (
                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <img src={logoPreview} alt="Logo Preview" style={{ width: '40px', height: '40px', borderRadius: '4px', border: '1px solid var(--primary)' }} />
                  <button onClick={() => { setLogoFile(null); setLogoPreview(null); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>Remove Logo</button>
                </div>
              )}
            </div>

            {/* 4. Export Settings Card */}
            <div className="config-section-card">
              <div className="config-section-title">💾 Output Format</div>
              <div className="config-grid">
                <div className="form-group">
                  <label>File Format</label>
                  <select value={config.format} onChange={(e) => setConfig({ ...config, format: e.target.value })}>
                    <option value="png">PNG (Recommended)</option>
                    <option value="jpeg">JPEG</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Resolution (px)</label>
                  <select value={config.width} onChange={(e) => setConfig({ ...config, width: Number(e.target.value) })}>
                    <option value={300}>300x300 (Standard)</option>
                    <option value={600}>600x600 (High Res)</option>
                    <option value={1200}>1200x1200 (Print Ready)</option>
                  </select>
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                  <input type="checkbox" id="showText" checked={config.showText} onChange={(e) => setConfig({ ...config, showText: e.target.checked })} style={{ width: '20px', height: '20px', cursor: 'pointer' }} />
                  <label htmlFor="showText" style={{ cursor: 'pointer', marginBottom: '0', fontSize: '14px', fontWeight: '500' }}>Show Number below QR</label>
                </div>
                {config.showText && (
                  <>
                    <div className="form-group">
                      <label>Font Size ({config.textFontSize}px)</label>
                      <input type="range" min="8" max="60" value={config.textFontSize} onChange={(e) => setConfig({ ...config, textFontSize: Number(e.target.value) })} />
                    </div>
                    <div className="form-group">
                      <label>Text Spacing ({config.textSpace || 0}px)</label>
                      <input type="range" min="0" max="100" value={config.textSpace || 0} onChange={(e) => setConfig({ ...config, textSpace: Number(e.target.value) })} />
                    </div>
                    <div className="form-group">
                      <label>Text Alignment</label>
                      <select value={config.textAlign || 'center'} onChange={(e) => setConfig({ ...config, textAlign: e.target.value })}>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button className="btn" style={{ backgroundColor: '#e2e8f0', color: '#4a5568', flex: 1 }} onClick={handleReset}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleGenerate} disabled={loading}>
                {loading ? (
                  <div style={{ width: '100%' }}>
                    <div style={{ marginBottom: '5px' }}>Processing... {progress.toFixed(0)}%</div>
                    <div className="progress-bar" style={{ height: '4px', background: 'rgba(255,255,255,0.3)' }}>
                      <div className="progress-fill" style={{ width: `${progress}%`, background: '#fff' }}></div>
                    </div>
                  </div>
                ) : 'Generate Bulk ZIP'}
              </button>
            </div>
            {loading && (
              <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-light)', marginTop: '10px' }}>
                Est. {countdown}s remaining. Do not close this tab.
              </p>
            )}
          </div>

          {/* Right Column: Previews & Status */}
          <div className="config-sidebar">
            <div className="stats-card">
              <div className="stat-item">
                <span className="stat-value">{stats.totalRows}</span>
                <span className="stat-label">Records</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{analysisTime > 10 ? `${analysisTime}ms` : '<10ms'}</span>
                <span className="stat-label">Analysis</span>
              </div>
            </div>

            <h3 style={{ marginBottom: '1rem', fontSize: '14px', color: 'var(--text-light)' }}>LIVE PREVIEW (Sample)</h3>
            <div className="preview-list">
              {previews.slice(0, 2).map((p, i) => (
                <div key={i} className="preview-card">
                  <img src={p.url} alt="Preview" style={{ width: '100%', height: 'auto', display: 'block' }} />
                </div>
              ))}
              {stats.totalRows > 2 && (
                <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-light)' }}>+ {stats.totalRows - 2} more to be generated</div>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
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
            <div className="stat-item">
              <span className="stat-value" style={{ color: 'var(--primary)' }}>{formatTime(totalTime)}</span>
              <span className="stat-label">Generation Time</span>
            </div>
          </div>
          <p style={{ marginBottom: '2rem', color: 'var(--text-light)' }}>Your ZIP file download should have started automatically.</p>
          <button className="btn btn-primary" onClick={handleReset}>Process Another File</button>
        </div>
      )}
    </div>
  );
}

export default App;
