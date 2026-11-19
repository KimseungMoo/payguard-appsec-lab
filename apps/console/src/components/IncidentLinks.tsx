import React from 'react';

const MODULE1_INCIDENTS = [
  {
    label: 'USPS (2018)',
    url: 'https://krebsonsecurity.com/2018/11/usps-site-exposed-data-on-60-million-users/',
  },
  {
    label: 'Peloton (2021)',
    url: 'https://www.infosecurity-magazine.com/news/peloton-apis-exposed-all-users/',
  },
] as const;

/** Clickable external source links for Module 1 real-world BOLA/IDOR incidents. */
export function IncidentLinks() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      {MODULE1_INCIDENTS.map((item, idx) => (
        <React.Fragment key={item.label}>
          {idx > 0 && <span style={{ color: '#64748b' }}>·</span>}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#93c5fd',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
              fontWeight: 600,
            }}
          >
            {item.label}
          </a>
        </React.Fragment>
      ))}
    </span>
  );
}
