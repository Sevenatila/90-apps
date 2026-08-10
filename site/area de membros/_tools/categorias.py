"""Mapa de categorias dos 36 apps (slug PT -> categoria)."""

CATEGORIAS = [
    {
        'id': 'mente',
        'nome': 'Mente e Bem-estar',
        'icone': '\U0001f9e0',
        'cor': '#7c6cf0',
        'apps': [
            'antiestresse_app', 'anti_ansiedade', 'anti_insonia',
            'inteligencia_emocional', 'matando_procrastinacao',
            'rotina_produtiva', 'reiki_app',
        ],
    },
    {
        'id': 'fitness',
        'nome': 'Fitness e Movimento',
        'icone': '\U0001f4aa',
        'cor': '#f0644c',
        'apps': [
            'barriga_de_aco', 'calistenia_sexy', 'cardio_em_casa',
            'gluteo_perfeito', 'pilates_app', 'yoga_essencial',
        ],
    },
    {
        'id': 'dieta',
        'nome': 'Dieta e Emagrecimento',
        'icone': '\U0001f957',
        'cor': '#3fb37f',
        'apps': [
            'cha_fim_da_panca', 'dieta_cetogenica', 'jejum_intermitente',
            'marmita_fitness', 'receitas_para_diabeticos',
            'sopa_termogenica', 'suco_detox',
        ],
    },
    {
        'id': 'culinaria',
        'nome': 'Culinaria Gourmet',
        'icone': '\U0001f9c1',
        'cor': '#e8a13a',
        'apps': [
            'bolo_gourmet', 'brigadeiros_gourmet', 'doces_sem_acucar',
            'geladinho_gourmet', 'iogurte_gourmet',
        ],
    },
    {
        'id': 'espiritual',
        'nome': 'Fe e Espiritualidade',
        'icone': '\U0001f54a️',
        'cor': '#4a9ee2',
        'apps': [
            'app_cristao', 'astrologia', 'espiritualidade_em_acao',
            'leitura_biblia', 'poder_da_oracao',
        ],
    },
    {
        'id': 'negocios',
        'nome': 'Negocios e Digital',
        'icone': '\U0001f4c8',
        'cor': '#d05ca8',
        'apps': [
            'copywriter_pro', 'expert_trafego_pago', 'freelancer_digital',
            'lucrando_com_ia', 'marketing_iniciante', 'vendas_whatsapp',
        ],
    },
]

if __name__ == '__main__':
    import os
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    reais = {d for d in os.listdir(os.path.join(base, 'apps'))
             if os.path.isdir(os.path.join(base, 'apps', d))}
    mapeados = [s for c in CATEGORIAS for s in c['apps']]
    print('mapeados: %d | apps reais: %d' % (len(mapeados), len(reais)))
    dup = {s for s in mapeados if mapeados.count(s) > 1}
    print('duplicados :', dup or 'nenhum')
    print('sem categoria:', reais - set(mapeados) or 'nenhum')
    print('inexistentes :', set(mapeados) - reais or 'nenhum')
    for c in CATEGORIAS:
        print('  %-22s %d' % (c['nome'], len(c['apps'])))
