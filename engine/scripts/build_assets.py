import json,os,shutil
from PIL import Image
B='/workspace/lizard-wizard/pc/cards_zip/LizardWizard_Cards/Spell_Cards/By_School/'
C='/workspace/lizard-wizard/cards/'
M={'Wild/image7x6':'Arch_Mage','alchemy/image10x5':'Master_Alchemist','alchemy/image1x5':'Invisibility_Potion','alchemy/image2x5':'Evolve','alchemy/image3x5':'Scribe','alchemy/image4x5':'Crystal_Ball','alchemy/image5x5':'Spell_Shield_A','alchemy/image6x4':'Transform','alchemy/image7x4':'Transmute','alchemy/image9x5':'Powerful_Helper',
'conjuring/image10x2':'Energy_Circle','conjuring/image1x2':'Treasure','conjuring/image6x2':'Summon_Helper','conjuring/image7x2':'Mana_Leak','conjuring/image8x2':'Mana_Drain','conjuring/image8x6':'Spell_Shield_C','conjuring/image9x2':'Creation','conjuring/image9x6':'Spell_Shield_C',
'druidry/image10x4':'Energize','druidry/image1x4':'Obscure','druidry/image2x4':'Bloom','druidry/image3x4':'Maximum_Gather','druidry/image4x4':'Flame_Bolt_D','druidry/image4x7':'Root_Cellar','druidry/image5x4':'Potent_Servant','druidry/image5x7':'Root_Cellar','druidry/image6x3':'Adept_Conversion','druidry/image8x4':'Mana_Garden','druidry/image9x4':'Earthquake',
'enchantment/image10x3':'Secret_Society','enchantment/image1x3':'Swapo','enchantment/image2x3':'Charm','enchantment/image3x3':'Wand_Tax','enchantment/image4x3':'Order_of_the_Wand','enchantment/image5x3':'Spirit_Shield','enchantment/image7x3':'Time_Shift','enchantment/image8x3':'Haste','enchantment/image9x3':'Spell_Shield_E',
'necromancy/image1x6':'Block_Denizens','necromancy/image2x6':'Block_Undead','necromancy/image3x6':'Control_Undead','necromancy/image4x6':'Disintegrate_N','necromancy/image5x6':'Rise','necromancy/image6x5':'Block_Giant','necromancy/image6x6':'Undying','necromancy/image7x5':'Block_Goblin','necromancy/image8x5':'Demonic_Possession',
'sorcery/image10x1':'Scry_Dungeon','sorcery/image1x1':'Scry_Wizard','sorcery/image2x1':'Scry_Tower','sorcery/image3x1':'Disintegrate_S','sorcery/image4x1':'Flame_Bolt_S','sorcery/image5x1':'Divination','sorcery/image6x1':'Scry_Familiar','sorcery/image7x1':'Hoard_Mana','sorcery/image8x1':'Energy_Pulse',
'thaumaturgy/image10x6':'Trap','thaumaturgy/image1x7':'Trap','thaumaturgy/image2x2':'Mana_Fountain','thaumaturgy/image2x7':'Spell_Shield_T','thaumaturgy/image3x2':'Inexpensive','thaumaturgy/image3x7':'Spell_Shield_T','thaumaturgy/image4x2':'Pulsing_Towers','thaumaturgy/image5x2':'Miracle','thaumaturgy/image9x1':'Perfect_Reagent'}
assert len(M)==65
inv={}
for k,v in M.items(): inv.setdefault(v,[]).append('Spell_Cards/By_School/'+k+'.png')
d=json.load(open(C+'spells_from_pc.json'))
assert set(inv)==set(c['id'] for c in d['cards'])
for c in d['cards']:
    c['copies']=len(inv[c['id']]);c['by_school_scans']=inv[c['id']];c['asset_image']='assets/Spell_%s.jpg'%c['id']
d['count']=61;d['distinct_spells']=61;d['physical_spell_cards_with_copies']=sum(c['copies'] for c in d['cards'])
d['copies_note']="Rulebook says 65 Spell cards. By_School has 65 clean scans: 61 distinct spells plus a second physical copy of Spell Shield (Conjuring), Spell Shield (Thaumaturgy), Trap! and Root Cellar (each copy was scanned at a different grid position; pixel-diff shows the faces are identical). No new spells were found beyond the 61 already transcribed. The 6 .jpeg files in By_School/necromancy are not spells (see other_cards_from_pc.json)."
json.dump(d,open(C+'spells_from_pc.json','w'),indent=1)
N='Spell_Cards/By_School/necromancy/'
other={'source':'Keith PC: LizardWizard_Cards/Spell_Cards/By_School/necromancy/*.jpeg (misfiled phone photos, not spells)','count':6,'cards':[
 {'id':'Wizard_Serpentium_Machinus','deck':'Wizard (inferred: portrait card with a reagent symbol in the top left, matching the rulebook description of Wizard Cards)','name':'Serpentium Machinus','school':'Thaumaturgy','school_side_label':'THAUMATURGY','gather_bonus_reagent_top_left':'Sulphur','other_text':'none besides the name','source_file':N+'1.jpeg','asset_image':'assets/Wizard_Serpentium_Machinus.jpg','transcription_status':'full'},
 {'id':'Wizard_Reptilius_Venenum','deck':'Wizard (inferred, same layout as above)','name':'Reptilius Venenum','school':'Alchemy','school_side_label':'ALCHEMY','gather_bonus_reagent_top_left':'Eye of Newt','other_text':'none besides the name','source_file':N+'6.jpeg','asset_image':'assets/Wizard_Reptilius_Venenum.jpg','transcription_status':'full'},
 {'id':'Familiar_Bufonem','deck':'Familiar','name':'Bufonem','school':'Alchemy','mana_cost':5,'abilities':[{'trigger':'New Research','effect':'Collect 3 Eye of Newt & Cast Spells','icon':'Eye of Newt'},{'trigger':'Enter the Dungeon','effect':'1 Gold / Alchemy Card','icon':'gold coin'}],'source_file':N+'2.jpeg','asset_image':'assets/Familiar_Bufonem.jpg','transcription_status':'full'},
 {'id':'Familiar_Corvum','deck':'Familiar','name':'Corvum','school':'Necromancy','mana_cost':5,'abilities':[{'trigger':'New Research','effect':'Collect 3 Nightshade & Cast Spells','icon':'Nightshade'},{'trigger':'Enter the Dungeon','effect':'1 Gold / Necromancy Card','icon':'gold coin'}],'source_file':N+'3.jpeg','asset_image':'assets/Familiar_Corvum.jpg','transcription_status':'full'},
 {'id':'Tower_Obsidian_Fortress','deck':'Tower','name':'Obsidian Fortress','school':'Necromancy','school_side_label':'NECROMANCY','cost':'3x Nightshade or 3 Gold','source_file':N+'4.jpeg','asset_image':'assets/Tower_Obsidian_Fortress.jpg','transcription_status':'full'},
 {'id':'Tower_Vermillion_Citadel','deck':'Tower','name':'Vermillion Citadel','school':'Conjuring','school_side_label':'CONJURING','cost':'3x Horn or 3 Gold','source_file':N+'5.jpeg','asset_image':'assets/Tower_Vermillion_Citadel.jpg','transcription_status':'full'}]}
json.dump(other,open(C+'other_cards_from_pc.json','w'),indent=1)
# assets
A='/workspace/lizard-wizard/assets/';os.makedirs(A,exist_ok=True)
root='/workspace/lizard-wizard/pc/cards_zip/LizardWizard_Cards/'
for cid,paths in inv.items():
    Image.open(root+paths[0]).convert('RGB').save(A+'Spell_%s.jpg'%cid,quality=92)
for c in other['cards']:
    im=Image.open(root+c['source_file']).convert('RGB');im.save(A+c['id']+'.jpg',quality=90)
r=json.load(open(C+'reagent_cards.json'))
for c in r['cards']:
    shutil.copy(root+c['source_file'],A+c['id']+'.jpg');c['asset_image']='assets/%s.jpg'%c['id']
json.dump(r,open(C+'reagent_cards.json','w'),indent=1)
for f in ['spells_from_pc.json','reagent_cards.json','other_cards_from_pc.json','pc_contact_sheet.jpg','reagent_contact_sheet.jpg']: shutil.copy(C+f,A+f)
print(len(os.listdir(A)))
