import React, { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { formatDateBR, parseBrDateToIso } from '../utils/dateFormat';

interface DateInputBRProps {
  value: string;
  onChange: (isoDate: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}

function applyDateMask(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

/**
 * Displays and edits dates strictly in DD-MM-YYYY (dia-mês-ano) regardless of browser/OS locale,
 * while emitting canonical YYYY-MM-DD strings via onChange for storage compatibility.
 */
export const DateInputBR: React.FC<DateInputBRProps> = ({
  value,
  onChange,
  required = false,
  disabled = false,
  placeholder = 'DD-MM-AAAA',
  className = '',
  id
}) => {
  const [displayValue, setDisplayValue] = useState<string>(() => formatDateBR(value, ''));
  const [invalid, setInvalid] = useState(false);
  const nativePickerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const formatted = formatDateBR(value, '');
    setDisplayValue(formatted);
    setInvalid(false);
  }, [value]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = applyDateMask(e.target.value);
    setDisplayValue(masked);

    if (!masked) {
      setInvalid(false);
      onChange('');
      return;
    }

    if (masked.length === 10) {
      const iso = parseBrDateToIso(masked);
      if (iso) {
        setInvalid(false);
        onChange(iso);
      } else {
        setInvalid(true);
      }
    } else {
      setInvalid(false);
    }
  };

  const handleBlur = () => {
    if (!displayValue.trim()) {
      setInvalid(false);
      return;
    }
    const iso = parseBrDateToIso(displayValue);
    if (iso) {
      setInvalid(false);
      setDisplayValue(formatDateBR(iso, ''));
      if (iso !== value) {
        onChange(iso);
      }
    } else {
      setInvalid(true);
    }
  };

  const openNativePicker = () => {
    if (disabled || !nativePickerRef.current) return;
    const picker = nativePickerRef.current as HTMLInputElement & { showPicker?: () => void };
    if (typeof picker.showPicker === 'function') {
      try {
        picker.showPicker();
        return;
      } catch {
        // Fallback below
      }
    }
    picker.click();
  };

  return (
    <div className="relative flex items-center">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        maxLength={10}
        value={displayValue}
        onChange={handleTextChange}
        onBlur={handleBlur}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        pattern="\d{2}-\d{2}-\d{4}"
        title="Informe a data no formato DD-MM-AAAA (ex: 14-11-2026)"
        className={`${className} pr-8 ${invalid ? '!border-rose-500' : ''}`}
      />
      <button
        type="button"
        onClick={openNativePicker}
        disabled={disabled}
        tabIndex={-1}
        aria-label="Selecionar data no calendário"
        className="absolute right-2 text-slate-400 hover:text-[#D4A72C] p-0.5 cursor-pointer disabled:opacity-40"
      >
        <Calendar size={14} />
      </button>
      <input
        ref={nativePickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : ''}
        onChange={(e) => {
          const iso = e.target.value;
          if (iso) {
            setInvalid(false);
            setDisplayValue(formatDateBR(iso, ''));
            onChange(iso);
          }
        }}
        className="sr-only pointer-events-none"
      />
    </div>
  );
};
