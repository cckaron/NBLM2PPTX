import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  IconButton,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  LinearProgress,
  Radio,
  RadioGroup,
  Select,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  Toolbar,
  Typography,
} from '@mui/material';

import { initPdfLibrary, loadPdfPages } from '../pdf.js';
import { readFileAsDataURL } from '../utils.js';
import { downscaleDataUrlToMaxSide, wait } from '../utils.js';
import { removeTextWithGemini, ocrWithGemini } from '../gemini.js';
import { postprocessOcrBlocks } from '../ocrPostprocess.js';
import { exportToPptx } from '../pptx.js';
import { setApiKey, setOcrModel, state } from '../state.js';

function classifyApiError(error) {
  const status = error?.status ?? error?.cause?.status;
  const msg = String(error?.message || '');
  const raw = String(error?.error?.message || '');
  const full = `${msg}\n${raw}`.toLowerCase();

  if (status === 429) {
    if (full.includes('resource_exhausted') || full.includes('quota') || full.includes('limit')) {
      return { kind: 'quota', status, userMessage: 'Quota exhausted (429). Check AI Studio usage & quotas.' };
    }
    return { kind: 'rate', status, userMessage: 'Rate limited (429). Slow down or retry later.' };
  }
  if (status === 403 && (full.includes('quota') || full.includes('exceeded'))) {
    return { kind: 'quota', status, userMessage: 'Quota exceeded (403). Check AI Studio usage & quotas.' };
  }
  return { kind: 'other', status, userMessage: msg || 'Request failed.' };
}

export default function App() {
  const [step, setStep] = useState('upload'); // upload | select | processing | results
  const [items, setItems] = useState([]);
  const [results, setResults] = useState([]);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });

  const [apiKeyInput, setApiKeyInput] = useState(state.apiKey || '');
  const [ocrMode, setOcrModeState] = useState('lite');
  const [clearTextEnabled, setClearTextEnabled] = useState(!!state.clearTextEnabled);
  const [optimizeEnabled, setOptimizeEnabled] = useState(!!state.optimizeImagesEnabled);
  const [optimizeMaxSide, setOptimizeMaxSide] = useState(state.optimizeMaxSidePx || 1024);

  const [progress, setProgress] = useState({ pct: 0, title: '', detail: '' });
  const fileInputRef = useRef(null);

  function toast(message, severity = 'info') {
    setSnack({ open: true, message, severity });
  }

  useEffect(() => {
    // keep shared state in sync (used by gemini.js)
    state.clearTextEnabled = clearTextEnabled;
    state.optimizeImagesEnabled = optimizeEnabled;
    state.optimizeMaxSidePx = optimizeMaxSide;
  }, [clearTextEnabled, optimizeEnabled, optimizeMaxSide]);

  useEffect(() => {
    // Default OCR mode and shared model
    setOcrModel(ocrMode);
  }, [ocrMode]);

  const modelsInUse = useMemo(() => {
    return {
      clearText: state.modelImageEdit,
      ocr: state.modelTextGen,
    };
  }, [clearTextEnabled, ocrMode, optimizeEnabled, optimizeMaxSide, apiKeyInput]);

  async function handleFiles(fileList) {
    if (!initPdfLibrary()) return;
    const fileArray = Array.from(fileList || []);
    const next = [];

    for (const file of fileArray) {
      if (file.type === 'application/pdf') {
        const pages = await loadPdfPages(file);
        next.push(...pages);
      } else if (file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataURL(file);
        next.push({
          type: 'image',
          name: file.name,
          thumbnail: dataUrl,
          fullImage: dataUrl,
          selected: true,
        });
      }
    }

    if (next.length) {
      setItems(next);
      setStep('select');
    }
  }

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function processSelected() {
    const selected = items.filter((i) => i.selected);
    if (!selected.length) return;

    setStep('processing');
    setResults([]);
    const out = [];

    for (let idx = 0; idx < selected.length; idx++) {
      const item = selected[idx];
      const pct = Math.round(((idx + 1) / selected.length) * 100);
      setProgress({ pct, title: `Processing ${idx + 1}/${selected.length}`, detail: item.name });

      try {
        if (!state.apiKey) throw new Error('Missing API key.');

        let imageForAI = item.fullImage;
        if (state.optimizeImagesEnabled && state.optimizeMaxSidePx > 0) {
          setProgress({
            pct,
            title: `Optimizing (${state.optimizeMaxSidePx}px max side)`,
            detail: item.name,
          });
          imageForAI = await downscaleDataUrlToMaxSide(item.fullImage, state.optimizeMaxSidePx);
        }

        let cleaned = null;
        if (state.clearTextEnabled) {
          setProgress({ pct, title: 'Clear text (background)', detail: item.name });
          try {
            cleaned = await removeTextWithGemini(imageForAI);
          } catch (e) {
            const info = classifyApiError(e);
            console.warn('Clear text failed:', info, e);
          }
        }

        setProgress({ pct, title: 'OCR (editable text)', detail: item.name });
        let blocks = [];
        try {
          blocks = await ocrWithGemini(imageForAI);
          blocks = postprocessOcrBlocks(blocks);
        } catch (e) {
          const info = classifyApiError(e);
          console.warn('OCR failed:', info, e);
        }

        if (!cleaned && (!blocks || blocks.length === 0)) {
          throw new Error('Both clear-text and OCR failed.');
        }

        out.push({
          name: item.name,
          original: item.fullImage,
          cleaned: cleaned || item.fullImage,
          textBlocks: blocks || [],
        });
      } catch (e) {
        const info = classifyApiError(e);
        out.push({
          name: item.name,
          original: item.fullImage,
          cleaned: item.fullImage,
          textBlocks: [],
          error: info.userMessage,
        });
      }

      await wait(800);
    }

    setResults(out);
    setStep('results');
  }

  function resetAll() {
    setItems([]);
    setResults([]);
    setProgress({ pct: 0, title: '', detail: '' });
    setStep('upload');
  }

  function saveKey() {
    const key = apiKeyInput.trim();
    if (!key) return toast('Please enter an API Key', 'warning');
    setApiKey(key);
    toast('API Key saved', 'success');
  }

  return (
    <>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: 'white', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar>
          <Stack direction="row" spacing={1} alignItems="baseline" sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
              NotebookLM → PPTX
            </Typography>
            <Chip size="small" label="React" variant="outlined" />
          </Stack>
          <Button variant="outlined" onClick={() => window.location.assign('/notebooklm2pptx.html')}>
            Legacy UI
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 3 }}>
        <Box sx={{ maxWidth: 920, mx: 'auto' }}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
                <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
                  NotebookLM → PPTX
                </Typography>
                <Typography sx={{ color: 'text.secondary', mt: 0.5 }}>
                  Convert NotebookLM exported PDFs to <b>editable</b> PowerPoint slides.
                </Typography>

                <Divider sx={{ my: 2 }} />

                {step === 'upload' && (
                  <Stack spacing={2}>
                    <Alert severity="info">
                      <b>Tip</b>: start with <b>Optimize 1024</b> and keep <b>🧽 Clear text</b> off to save cost.
                    </Alert>

                    <Card
                      variant="outlined"
                      sx={{
                        borderRadius: 3,
                        borderStyle: 'dashed',
                        borderWidth: 2,
                        borderColor: 'divider',
                        bgcolor: 'rgba(59,130,246,0.03)',
                      }}
                      onDragEnter={preventDefaults}
                      onDragOver={preventDefaults}
                      onDragLeave={preventDefaults}
                      onDrop={(e) => {
                        preventDefaults(e);
                        handleFiles(e.dataTransfer.files);
                      }}
                    >
                      <CardContent>
                        <Stack spacing={1} alignItems="center" textAlign="center">
                          <Typography sx={{ fontWeight: 900 }}>📄 Drop PDF / images here</Typography>
                          <Typography variant="body2" color="text.secondary">
                            or click to select files (PDF, PNG, JPG)
                          </Typography>
                          <Button variant="contained" size="large" onClick={() => fileInputRef.current?.click()}>
                            Choose files
                          </Button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,image/*"
                            multiple
                            style={{ display: 'none' }}
                            onChange={(e) => handleFiles(e.target.files)}
                          />
                        </Stack>
                      </CardContent>
                    </Card>

                    <Card variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent>
                        <Typography sx={{ fontWeight: 900, mb: 0.5 }}>🚀 Quick start</Typography>
                        <Stack spacing={0.5}>
                          <Typography variant="body2" color="text.secondary"><b>1)</b> Upload PDF/images</Typography>
                          <Typography variant="body2" color="text.secondary"><b>2)</b> Select pages</Typography>
                          <Typography variant="body2" color="text.secondary"><b>3)</b> Process → Export PPTX</Typography>
                        </Stack>
                      </CardContent>
                    </Card>

                    <Card variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent>
                        <Typography sx={{ fontWeight: 900, mb: 1 }}>⚙️ Settings</Typography>
                        <Stack spacing={1.5}>
                          <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
                            <FormControlLabel
                              control={<Switch checked={clearTextEnabled} onChange={(e) => setClearTextEnabled(e.target.checked)} />}
                              label={<span><b>🧽 Clear text</b> <span style={{ color: 'rgba(0,0,0,0.55)' }}>(remove text)</span></span>}
                            />
                            <Chip
                              size="small"
                              label={clearTextEnabled ? 'On' : 'Off'}
                              color={clearTextEnabled ? 'success' : 'default'}
                              variant={clearTextEnabled ? 'filled' : 'outlined'}
                            />
                          </Stack>

                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                            <FormControlLabel
                              control={<Switch checked={optimizeEnabled} onChange={(e) => setOptimizeEnabled(e.target.checked)} />}
                              label={<span><b>💸 Optimize</b> <span style={{ color: 'rgba(0,0,0,0.55)' }}>(downscale before AI)</span></span>}
                            />
                            <FormControl size="small" sx={{ minWidth: 220 }}>
                              <Select
                                value={String(optimizeMaxSide)}
                                onChange={(e) => setOptimizeMaxSide(Number(e.target.value))}
                                disabled={!optimizeEnabled}
                              >
                                <MenuItem value="512">512 (cheapest)</MenuItem>
                                <MenuItem value="1024">1024 (recommended)</MenuItem>
                                <MenuItem value="1536">1536</MenuItem>
                                <MenuItem value="2048">2048 (sharper, more cost)</MenuItem>
                                <MenuItem value="0">Original</MenuItem>
                              </Select>
                            </FormControl>
                          </Stack>

                          <FormControl>
                            <FormLabel sx={{ fontWeight: 900 }}>🔎 OCR mode</FormLabel>
                            <RadioGroup
                              row
                              value={ocrMode}
                              onChange={(e) => setOcrModeState(e.target.value)}
                            >
                              <FormControlLabel value="lite" control={<Radio />} label="⚡ Lite" />
                              <FormControlLabel value="standard" control={<Radio />} label="🎨 Standard" />
                            </RadioGroup>
                          </FormControl>
                        </Stack>
                      </CardContent>
                    </Card>

                    <Card variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent>
                        <Typography sx={{ fontWeight: 900, mb: 1 }}>🧠 Models in use</Typography>
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Chip size="small" label={`Clear text: ${modelsInUse.clearText}`} variant="outlined" />
                            <Chip size="small" label={`OCR: ${modelsInUse.ocr}`} variant="outlined" />
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>

                    <Card variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent>
                        <Typography sx={{ fontWeight: 900, mb: 1 }}>🧰 Optional tools</Typography>
                        <Stack spacing={1}>
                          <Button
                            variant="outlined"
                            component="a"
                            href="https://www.notebooklmwatermark.com/"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Remove watermark (external)
                          </Button>
                          <Button
                            variant="outlined"
                            component="a"
                            href="https://shrinkpdf.com/"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Compress PDF (external)
                          </Button>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                          These run outside this app. Your original files aren’t modified here.
                        </Typography>
                      </CardContent>
                    </Card>

                    <Card variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent>
                        <Typography sx={{ fontWeight: 900, mb: 1 }}>🔑 API key</Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                          <input
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            placeholder="Gemini API key (AIza...)"
                            style={{
                              flex: 1,
                              padding: '10px 12px',
                              borderRadius: 12,
                              border: '1px solid rgba(148,163,184,0.6)',
                              outline: 'none',
                            }}
                          />
                          <Button variant="contained" onClick={saveKey}>
                            Save
                          </Button>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                          Stored in localStorage. Avoid exposing keys in production.
                        </Typography>
                      </CardContent>
                    </Card>
                  </Stack>
                )}

                {step === 'select' && (
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography sx={{ fontWeight: 900 }}>🖼️ Select pages</Typography>
                      <Stack direction="row" spacing={1}>
                        <Button size="small" variant="outlined" onClick={() => setItems((prev) => prev.map((p) => ({ ...p, selected: true })))}>
                          Select all
                        </Button>
                        <Button size="small" variant="outlined" onClick={() => setItems((prev) => prev.map((p) => ({ ...p, selected: false })))}>
                          Deselect all
                        </Button>
                      </Stack>
                    </Stack>

                    <Grid container spacing={1.5}>
                      {items.map((it, i) => (
                        <Grid item xs={4} sm={3} md={2} key={i}>
                          <Card
                            variant="outlined"
                            sx={{
                              borderRadius: 2,
                              borderColor: it.selected ? 'primary.main' : 'divider',
                              boxShadow: it.selected ? '0 0 0 3px rgba(59,130,246,0.12)' : 'none',
                              cursor: 'pointer',
                            }}
                            onClick={() =>
                              setItems((prev) => prev.map((p, idx) => (idx === i ? { ...p, selected: !p.selected } : p)))
                            }
                          >
                            <CardContent sx={{ p: 1.25 }}>
                              <Box
                                component="img"
                                src={it.thumbnail}
                                alt={it.name}
                                sx={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 1, display: 'block' }}
                              />
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                                {it.name}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>

                    <Divider />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button variant="outlined" onClick={resetAll}>Start over</Button>
                      <Button variant="contained" onClick={processSelected}>Process</Button>
                    </Stack>
                  </Stack>
                )}

                {step === 'processing' && (
                  <Stack spacing={2}>
                    <Typography sx={{ fontWeight: 900 }}>{progress.title || 'Processing...'}</Typography>
                    <LinearProgress variant="determinate" value={progress.pct} sx={{ height: 10, borderRadius: 99 }} />
                    <Typography variant="body2" color="text.secondary">
                      {progress.detail}
                    </Typography>
                  </Stack>
                )}

                {step === 'results' && (
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography sx={{ fontWeight: 900 }}>✅ Results</Typography>
                      <Stack direction="row" spacing={1}>
                        <Button variant="outlined" onClick={resetAll}>Start over</Button>
                        <Button variant="contained" onClick={async () => { await exportToPptx(results); toast('PPTX exported successfully!', 'success'); }}>
                          Export PPTX
                        </Button>
                      </Stack>
                    </Stack>

                    <Grid container spacing={1.5}>
                      {results.map((r, i) => (
                        <Grid item xs={12} sm={6} md={4} key={i}>
                          <Card variant="outlined" sx={{ borderRadius: 2 }}>
                            <Box component="img" src={r.cleaned} alt={r.name} sx={{ width: '100%', display: 'block' }} />
                            <CardContent>
                              <Typography sx={{ fontWeight: 800 }} noWrap>
                                {r.name}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {r.error ? r.error : `${r.textBlocks?.length || 0} text blocks`}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>
                  </Stack>
                )}
              </CardContent>
          </Card>
        </Box>
      </Container>

      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          severity={snack.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </>
  );
}

